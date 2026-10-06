package com.possoftware.pos.printer

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.security.SecureRandom
import java.util.Locale

/**
 * NativeModules.PosPrinter: the JS-facing surface. Every method returns at once and settles its
 * promise off the UI thread (the printing work runs on PrinterThreads). No payloads are logged.
 */
class PosPrinterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = "PosPrinter"
    private const val TOKEN_BYTES = 32
    private const val BYTE_MASK = 0xFF
    private const val MAX_ORIGIN_CHARS = 2048
    private const val ATTACH_RETRIES = 20
    private const val ATTACH_RETRY_DELAY_MS = 50L
    private const val UNKNOWN_VERSION = "unknown"
  }

  private val host = HostController(reactContext)
  private val bluetoothEnabler = BluetoothEnabler(reactContext)

  override fun getName(): String = NAME

  override fun initialize() {
    PrinterPool.init(reactContext)
    reactContext.addLifecycleEventListener(this)
    reactContext.addActivityEventListener(bluetoothEnabler.activityListener)
  }

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    reactContext.removeActivityEventListener(bluetoothEnabler.activityListener)
    WebViewDelivery.detach()
  }

  override fun onHostResume() {
    PrinterPool.appVisible = true
    PrinterApi.refreshStatus { }
    host.onResume()
  }

  override fun onHostPause() {
    PrinterPool.appVisible = false
  }

  override fun onHostDestroy() {
    PrinterPool.appVisible = false
    host.stopHost()
  }

  // ---- helpers ----

  private fun fail(promise: Promise, code: String) {
    promise.reject(code, Messages.of(code))
  }

  private inline fun guarded(promise: Promise, code: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      fail(promise, code)
    }
  }

  private fun <T> settle(promise: Promise, reply: Reply<T>, convert: (T) -> Any?) {
    when (reply) {
      is Reply.Ok -> promise.resolve(convert(reply.value))
      is Reply.Err -> promise.reject(reply.code, reply.message)
    }
  }

  private fun settleStatus(promise: Promise, reply: Reply<StatusSnapshot>) {
    settle(promise, reply) { StatusJson.toMap(it) }
  }

  private fun settlePool(promise: Promise, reply: Reply<PoolSnapshot>) {
    settle(promise, reply) { StatusJson.poolMap(it) }
  }

  private fun settleBytes(promise: Promise, reply: Reply<Int>) {
    settle(promise, reply) { count -> Arguments.createMap().apply { putInt("bytes", count) } }
  }

  @Suppress("DEPRECATION") // the flags-only overload is the one that exists on API 24..32
  private fun appVersion(): String =
      try {
        val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
        info.versionName ?: UNKNOWN_VERSION
      } catch (e: Exception) {
        UNKNOWN_VERSION
      }

  // ---- saved address ----

  @ReactMethod
  fun getSavedOrigin(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { promise.resolve(Prefs.origin(reactContext)) }
  }

  @ReactMethod
  fun saveOrigin(origin: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      if (origin.isBlank() || origin.length > MAX_ORIGIN_CHARS) {
        fail(promise, BridgeCodes.BAD_REQUEST)
      } else {
        Prefs.saveOrigin(reactContext, origin)
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun clearOrigin(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      Prefs.clearOrigin(reactContext)
      promise.resolve(null)
    }
  }

  // ---- identity ----

  @ReactMethod
  fun newToken(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      val bytes = ByteArray(TOKEN_BYTES)
      SecureRandom().nextBytes(bytes)
      val hex = StringBuilder(TOKEN_BYTES * 2)
      for (b in bytes) hex.append(String.format(Locale.ROOT, "%02x", b.toInt() and BYTE_MASK))
      promise.resolve(hex.toString())
    }
  }

  @ReactMethod
  fun appInfo(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      val map = Arguments.createMap()
      map.putString("appVersion", appVersion())
      map.putString("platform", BridgeCodes.PLATFORM)
      val transports = Arguments.createArray()
      for (transport in BridgeCodes.TRANSPORTS) transports.pushString(transport)
      map.putArray("transports", transports)
      promise.resolve(map)
    }
  }

  // ---- printer ----

  @ReactMethod
  fun getStatus(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      promise.resolve(StatusJson.toMap(PrinterPool.status()))
    }
  }

  @ReactMethod
  fun listPrinters(scan: Boolean, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.listPrinters(scan) { reply ->
        settle(promise, reply) { list ->
          val printers = Arguments.createArray()
          for (printer in list) printers.pushMap(StatusJson.printerMap(printer))
          Arguments.createMap().apply { putArray("printers", printers) }
        }
      }
    }
  }

  @ReactMethod
  fun selectPrinter(id: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.selectPrinter(id) { reply -> settleStatus(promise, reply) }
    }
  }

  @ReactMethod
  fun selectTcp(host: String, port: Int, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.selectTcp(host, port) { reply -> settleStatus(promise, reply) }
    }
  }

  @ReactMethod
  fun reconnect(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.reconnect { reply -> settleStatus(promise, reply) }
    }
  }

  @ReactMethod
  fun forget(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.forget { reply -> settleStatus(promise, reply) }
    }
  }

  @ReactMethod
  fun refreshStatus(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      PrinterApi.refreshStatus { reply -> settleStatus(promise, reply) }
    }
  }

  @ReactMethod
  fun print(base64: String, promise: Promise) {
    guarded(promise, BridgeCodes.WRITE_FAILED) { PrinterApi.print(base64) { reply -> settleBytes(promise, reply) } }
  }

  // ---- the app's printers (bridge v2, Phase 2 Session 2F2): each names its printer, each answer but the print's is
  // the whole list ----

  @ReactMethod
  fun poolStatus(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { promise.resolve(StatusJson.poolMap(PrinterPool.poolStatus())) }
  }

  @ReactMethod
  fun poolSelectPrinter(id: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { PrinterApi.poolSelectPrinter(id) { reply -> settlePool(promise, reply) } }
  }

  @ReactMethod
  fun poolSelectTcp(host: String, port: Int, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { PrinterApi.poolSelectTcp(host, port) { reply -> settlePool(promise, reply) } }
  }

  @ReactMethod
  fun poolReconnect(printerId: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { PrinterApi.poolReconnect(printerId) { reply -> settlePool(promise, reply) } }
  }

  @ReactMethod
  fun poolForget(printerId: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { PrinterApi.poolForget(printerId) { reply -> settlePool(promise, reply) } }
  }

  @ReactMethod
  fun poolPrint(printerId: String, base64: String, promise: Promise) {
    guarded(promise, BridgeCodes.WRITE_FAILED) { PrinterApi.poolPrint(printerId, base64) { reply -> settleBytes(promise, reply) } }
  }

  @ReactMethod
  fun enableBluetooth(promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) { bluetoothEnabler.request(promise) }
  }

  // ---- background host ----

  @ReactMethod
  fun setHostActive(active: Boolean, label: String, promise: Promise) {
    guarded(promise, BridgeCodes.UNSUPPORTED) {
      val result = host.setActive(active, label)
      promise.resolve(Arguments.createMap().apply { putBoolean("active", result) })
    }
  }

  @ReactMethod
  fun moveTaskToBack(promise: Promise) {
    UiThreadUtil.runOnUiThread(Runnable { reactContext.currentActivity?.moveTaskToBack(true) })
    promise.resolve(null)
  }

  // ---- WebView ----

  /** Resolves the WebView by React tag and installs the document-start script (retries while mounting). */
  @ReactMethod
  fun attachWebView(tag: Int, script: String, origin: String, promise: Promise) {
    attemptAttach(tag, script, origin, promise, ATTACH_RETRIES)
  }

  private fun attemptAttach(tag: Int, script: String, origin: String, promise: Promise, left: Int) {
    UiThreadUtil.runOnUiThread(
        Runnable {
          val documentStart =
              try {
                WebViewDelivery.attach(reactContext, tag, script, origin)
              } catch (e: RuntimeException) {
                null
              }
          if (documentStart != null) {
            promise.resolve(Arguments.createMap().apply { putBoolean("documentStart", documentStart) })
          } else if (left > 0) {
            // The Fabric view may not be mounted yet; look again shortly.
            UiThreadUtil.runOnUiThread(
                Runnable { attemptAttach(tag, script, origin, promise, left - 1) },
                ATTACH_RETRY_DELAY_MS,
            )
          } else {
            fail(promise, BridgeCodes.UNSUPPORTED)
          }
        }
    )
  }

  /** Runs a script the JS layer built (request replies) on the attached WebView. */
  @ReactMethod
  fun deliverScript(script: String, promise: Promise) {
    WebViewDelivery.deliverScript(script)
    promise.resolve(null)
  }
}
