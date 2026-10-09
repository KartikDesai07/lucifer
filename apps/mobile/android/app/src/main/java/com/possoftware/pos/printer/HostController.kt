package com.possoftware.pos.printer

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil

/** "Print all slips here": the foreground service, keep-screen-on and the one-time battery prompt. Phase 3 Session 3D
 *  (spec §9.5): the page's wish is kept ([Prefs.printing]) so a restart, a reboot or an update says printing is off, and
 *  the notification permission (Android 13+) is asked once, the first time printing starts. */
class HostController(private val ctx: ReactApplicationContext) {
  companion object {
    private const val NOTIFICATIONS_REQUEST = 4103
  }

  @Volatile private var active = false

  /** Returns whether the host is active after the call. */
  fun setActive(wanted: Boolean, label: String): Boolean {
    if (!wanted) {
      // The page's own "no": this device no longer prints for the cafe (cleared before the stop, so no notice). The 3D
      // review gate (N-2): a "POS printing is off" notice a reboot or an update left goes too.
      Prefs.setPrinting(ctx.applicationContext, false)
      stopHost()
      PrintingOffNotice.cancel(ctx.applicationContext)
      return false
    }
    // A background start is refused by Android 12+; the page re-asks when the app is visible again.
    if (!PrinterPool.appVisible) return false
    return try {
      PrintHostService.start(ctx.applicationContext, label)
      Prefs.setPrinting(ctx.applicationContext, true)
      active = true
      applyScreenFlag(true)
      if (!askNotificationsOnce()) promptBatteryOnce()
      true
    } catch (e: IllegalStateException) {
      false
    } catch (e: SecurityException) {
      false
    }
  }

  fun stopHost() {
    active = false
    PrintHostService.stop(ctx.applicationContext)
    applyScreenFlag(false)
  }

  fun onResume() {
    if (active) applyScreenFlag(true)
  }

  private fun applyScreenFlag(on: Boolean) {
    UiThreadUtil.runOnUiThread(
        Runnable {
          val window = ctx.currentActivity?.window
          if (window != null) {
            if (on) {
              window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
              window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
          }
        }
    )
  }

  /** Asks Android to exempt the app from battery optimisation, once per install. */
  private fun promptBatteryOnce() {
    val app = ctx.applicationContext
    if (Prefs.batteryPrompted(app)) return
    Prefs.markBatteryPrompted(app)
    val power = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    if (power.isIgnoringBatteryOptimizations(app.packageName)) return
    UiThreadUtil.runOnUiThread(
        Runnable {
          val activity = ctx.currentActivity
          if (activity != null) {
            try {
              activity.startActivity(
                  Intent(
                      Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                      Uri.parse("package:" + app.packageName),
                  )
              )
            } catch (e: ActivityNotFoundException) {
              // This device has no such screen.
            } catch (e: SecurityException) {
              // Not allowed on this device.
            }
          }
        }
    )
  }

  /** Session 3D: Android 13+ shows no notification of this app (not "Printing is on", not "POS printing is off. Tap to
   *  start.") until it may post them; asked once per install, so staff who say no are not asked again. True when asked
   *  now (the battery prompt then waits for the next start: never two system screens at once). */
  private fun askNotificationsOnce(): Boolean {
    val app = ctx.applicationContext
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
    if (ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return false
    if (Prefs.notificationsAsked(app)) return false
    UiThreadUtil.runOnUiThread(
        Runnable {
          // Two starts within one hop to the UI thread ask once (the 3D gold's second review, m-3).
          if (Prefs.notificationsAsked(app)) return@Runnable
          val activity = ctx.currentActivity
          if (activity != null) {
            try {
              ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATIONS_REQUEST)
              // Marked once Android was asked (the 3D gold's review, m-2): with no screen to ask on, it asks next time.
              Prefs.markNotificationsAsked(app)
            } catch (e: RuntimeException) {
              // No permission screen on this device.
            }
          }
        }
    )
    return true
  }
}
