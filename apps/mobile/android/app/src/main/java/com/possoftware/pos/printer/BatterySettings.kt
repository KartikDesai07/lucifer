package com.possoftware.pos.printer

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * Phase 3 Session 3D (spec §9.5): the battery checklist's links into the phone's settings, where Android allows them:
 * this app's battery optimisation (Android's own question, or its list once answered), the brand's autostart screen
 * ([BatteryTargets], best effort), and this app's settings screen (always there: every other link falls back to it).
 * Local only: no request.
 */
object BatterySettings {
  const val BATTERY = "battery"
  const val AUTOSTART = "autostart"
  const val APP = "app"

  fun brand(): String = BatteryTargets.brandOf(Build.MANUFACTURER ?: "")

  /** Android already lets this app run in the background with no battery limit. */
  fun unrestricted(ctx: Context): Boolean {
    val power = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return power.isIgnoringBatteryOptimizations(ctx.packageName)
  }

  /** Opens the screen for [kind]; false when none could open. */
  fun open(activity: Activity, kind: String): Boolean {
    val pkg = activity.packageName
    val tries =
        when (kind) {
          BATTERY ->
              if (unrestricted(activity)) listOf(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
              else listOf(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg")))
          AUTOSTART -> BatteryTargets.autostartScreens(brand()).map { (p, c) -> Intent().setComponent(ComponentName(p, c)) }
          else -> emptyList()
        } + Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
    for (intent in tries) {
      try {
        activity.startActivity(intent)
        return true
      } catch (e: ActivityNotFoundException) {
        // Not on this phone: the next one.
      } catch (e: SecurityException) {
        // Not open to other apps on this phone: the next one.
      }
    }
    return false
  }
}
