package com.possoftware.pos.printer

/**
 * Phase 3 Session 3D (spec §9.5): the battery checklist's facts about this phone. Phones from Xiaomi, OPPO, vivo and
 * Samsung stop apps in the background beyond what Android itself does (dontkillmyapp.com); each has its own screens.
 * Pure (no Android), so the JVM tests (src/test) pin it.
 */
object BatteryTargets {
  const val XIAOMI = "xiaomi"
  const val OPPO = "oppo"
  const val VIVO = "vivo"
  const val SAMSUNG = "samsung"
  const val OTHER = "other"

  /** The brand whose steps apply, from Build.MANUFACTURER (Redmi and POCO are Xiaomi's; realme and OnePlus run OPPO's
   *  ColorOS; iQOO is vivo's). */
  fun brandOf(manufacturer: String): String =
      when (manufacturer.trim().lowercase()) {
        "xiaomi", "redmi", "poco" -> XIAOMI
        "oppo", "realme", "oneplus" -> OPPO
        "vivo", "iqoo" -> VIVO
        "samsung" -> SAMSUNG
        else -> OTHER
      }

  /** The brand's own screen where apps may start and run in the background (package, activity), tried in order; none
   *  opens on another phone, or one that changed them, so the app's own settings screen is the fallback. */
  fun autostartScreens(brand: String): List<Pair<String, String>> =
      when (brand) {
        XIAOMI -> listOf("com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity")
        OPPO ->
            listOf(
                "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
                "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            )
        VIVO ->
            listOf(
                "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            )
        SAMSUNG ->
            listOf(
                "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
                "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",
                "com.samsung.android.sm" to "com.samsung.android.sm.ui.battery.BatteryActivity",
            )
        else -> emptyList()
      }
}
