package com.possoftware.pos.update

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.possoftware.pos.BuildConfig
import com.possoftware.pos.R
import com.possoftware.pos.printer.PrinterPool
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * NativeModules.PosUpdate (spec §6): the Android updater at run time. At an app open ([UpdateSchedule]: the first view
 * after the process started, or back after 30 minutes away) it looks for an update when its last look is 12 hours old,
 * on its own background thread: `latest.json` ([UpdateManifest]), then the APK it names ([UpdateDownloader], [ApkCheck]).
 * The card ([takeCard]) goes to the POS screen at most once per open, only for an update verified before that open, and
 * only while no printer of this app has a job in flight (otherwise it follows as [CARD_EVENT] once they are idle, while
 * the app stays in view). [install] starts Android's installer only from a tap on the card. Never a blocking screen,
 * never an install without a tap (spec D3).
 *
 * Threads: the lifecycle callbacks and [takeCard] run on the main thread, the only one that touches [schedule] and
 * [waiting] (the N1 review's I-2); the requests and the install run on [worker].
 */
class PosUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = "PosUpdate"
    const val CARD_EVENT = "PosUpdateCard"
    const val RESULT_EVENT = "PosUpdateResult"
    private const val TAG = UpdateDownloader.TAG
    private const val MINUTE_MS = 60_000L
    private const val IDLE_POLL_MS = 2_000L
    private const val INSTALL_IDLE_WAIT_MS = 30_000L
    private const val INSTALL_IDLE_POLL_MS = 500L
  }

  private val installedCode = BuildConfig.VERSION_CODE
  private val base = reactContext.getString(R.string.pos_update_base)
  private val schedule =
      UpdateSchedule(
          installedCode,
          reactContext.resources.getInteger(R.integer.pos_update_check_minutes) * MINUTE_MS,
          reactContext.resources.getInteger(R.integer.pos_update_reopen_minutes) * MINUTE_MS,
      )
  private val worker: ExecutorService =
      Executors.newSingleThreadExecutor { r -> Thread(r, "pos-update").apply { isDaemon = true } }
  private val checking = AtomicBoolean(false)
  private val main = Handler(Looper.getMainLooper())
  private var waiting: UpdateStore.Verified? = null

  override fun getName(): String = NAME

  override fun initialize() {
    UpdateStore.startUp(reactContext, installedCode)
    UpdateInstallReceiver.onFailed = { emitResult(false) }
    reactContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    UpdateInstallReceiver.onFailed = null
    reactContext.removeLifecycleEventListener(this)
    main.removeCallbacksAndMessages(null)
    worker.shutdown()
  }

  override fun onHostResume() {
    val open = schedule.shown(SystemClock.elapsedRealtime(), UpdateStore.verified(reactContext)?.versionCode)
    if (open) Log.i(TAG, "open")
    if (open && schedule.checkDue(System.currentTimeMillis(), UpdateStore.lastCheckAt(reactContext))) check()
  }

  override fun onHostPause() {
    schedule.hidden(SystemClock.elapsedRealtime())
    waiting = null
    main.removeCallbacksAndMessages(null)
  }

  override fun onHostDestroy() {
    onHostPause()
  }

  /** One look at a time, on [worker]. Any failure (no network, a bad file, an Error) only logs; the next open tries
   *  again. */
  private fun check() {
    if (!checking.compareAndSet(false, true)) return
    worker.execute {
      try {
        lookAndDownload()
      } catch (t: Throwable) {
        Log.i(TAG, "check: " + t.javaClass.simpleName)
      } finally {
        checking.set(false)
      }
    }
  }

  private fun lookAndDownload() {
    val fetched = UpdateDownloader.fetchManifest(base)
    if (fetched == null) {
      Log.i(TAG, "check: no answer")
      return
    }
    // Any HTTP answer counts as a look (a network error looks again at the next open).
    UpdateStore.setLastCheckAt(reactContext, System.currentTimeMillis())
    val body = fetched.body
    if (body == null) {
      Log.i(TAG, "check: HTTP " + fetched.status)
      return
    }
    when (val result = UpdateManifest.read(body, reactContext.packageName, installedCode, Build.SUPPORTED_ABIS.toList())) {
      is UpdateManifest.Ignored -> Log.i(TAG, "check: ignored (" + result.reason + ")")
      is UpdateManifest.Accepted -> {
        val offer = result.offer
        val kept = UpdateStore.verified(reactContext)
        if (kept != null && kept.versionCode == offer.versionCode && kept.sha256 == offer.sha256) {
          Log.i(TAG, "check: " + offer.version + " is ready")
          return
        }
        UpdateStore.clearVerified(reactContext)
        val apk = UpdateDownloader.download(reactContext, base, offer) ?: return
        UpdateStore.saveVerified(
            reactContext,
            UpdateStore.Verified(offer.versionCode, offer.version, offer.notes, apk.name, offer.sha256),
        )
      }
    }
  }

  /** spec §6.3: the card for this app open, at most once; null when there is none. While a printer of this app has a
   *  job in flight the card waits, and follows as [CARD_EVENT] once every printer is idle, if the app is still in view
   *  (going away drops it). */
  @ReactMethod
  fun takeCard(promise: Promise) {
    UiThreadUtil.runOnUiThread(
        Runnable {
          val code = schedule.takeCard()
          val update = UpdateStore.verified(reactContext)?.takeIf { it.versionCode == code }
          when {
            update == null -> promise.resolve(null)
            PrinterPool.anyPrinting() -> {
              Log.i(TAG, "card: waits for a print")
              waiting = update
              main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
              promise.resolve(null)
            }
            else -> {
              Log.i(TAG, "card: " + update.version)
              promise.resolve(cardOf(update))
            }
          }
        }
    )
  }

  private fun offerWhenIdle() {
    val update = waiting ?: return
    if (PrinterPool.anyPrinting()) {
      main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
      return
    }
    waiting = null
    Log.i(TAG, "card: " + update.version + " after the print")
    reactContext.emitDeviceEvent(CARD_EVENT, cardOf(update))
  }

  /** Only from a tap on the card's Install: waits up to 30 s for the printers to be idle, then hands the verified file
   *  to Android's installer. Resolves "started", "permission", "missing" or "failed". */
  @ReactMethod
  fun install(promise: Promise) {
    worker.execute {
      val start =
          try {
            var waited = 0L
            while (PrinterPool.anyPrinting() && waited < INSTALL_IDLE_WAIT_MS) {
              Thread.sleep(INSTALL_IDLE_POLL_MS)
              waited += INSTALL_IDLE_POLL_MS
            }
            val update = UpdateStore.verified(reactContext)
            if (update == null) {
              UpdateInstaller.InstallStart.MISSING
            } else {
              UpdateInstaller.install(reactContext, File(UpdateStore.updatesDir(reactContext), update.file))
            }
          } catch (t: Throwable) {
            UpdateInstaller.InstallStart.FAILED
          }
      Log.i(TAG, "install: " + start.answer)
      promise.resolve(start.answer)
    }
  }

  /** Later on the card: nothing to keep (the next app open offers it again). */
  @ReactMethod
  fun later() {
    Log.i(TAG, "card: later")
  }

  private fun cardOf(update: UpdateStore.Verified): WritableMap =
      Arguments.createMap().apply {
        putString("version", update.version)
        putString("notes", update.notes)
      }

  private fun emitResult(ok: Boolean) {
    reactContext.emitDeviceEvent(RESULT_EVENT, Arguments.createMap().apply { putBoolean("ok", ok) })
  }
}
