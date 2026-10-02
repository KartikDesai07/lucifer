package com.possoftware.pos.printer

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil

/** "Print all slips here": the foreground service, keep-screen-on and the one-time battery prompt. */
class HostController(private val ctx: ReactApplicationContext) {
  @Volatile private var active = false

  /** Returns whether the host is active after the call. */
  fun setActive(wanted: Boolean, label: String): Boolean {
    if (!wanted) {
      stopHost()
      return false
    }
    // A background start is refused by Android 12+; the page re-asks when the app is visible again.
    if (!PrinterManager.appVisible) return false
    return try {
      PrintHostService.start(ctx.applicationContext, label)
      active = true
      applyScreenFlag(true)
      promptBatteryOnce()
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
}
