package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 Session 3D (spec §9.5): the battery checklist's brand (from Build.MANUFACTURER) and each brand's own
 * autostart screen, tried in order (the app's settings screen is the fallback everywhere).
 */
class BatteryTargetsTest {
  @Test
  fun eachMakerReadsAsTheBrandWhoseStepsApply() {
    assertEquals(BatteryTargets.XIAOMI, BatteryTargets.brandOf("Xiaomi"))
    assertEquals("Redmi and POCO are Xiaomi's", BatteryTargets.XIAOMI, BatteryTargets.brandOf("Redmi"))
    assertEquals(BatteryTargets.XIAOMI, BatteryTargets.brandOf("POCO"))
    assertEquals(BatteryTargets.OPPO, BatteryTargets.brandOf("OPPO"))
    assertEquals("realme and OnePlus run ColorOS", BatteryTargets.OPPO, BatteryTargets.brandOf("realme"))
    assertEquals(BatteryTargets.OPPO, BatteryTargets.brandOf("OnePlus"))
    assertEquals(BatteryTargets.VIVO, BatteryTargets.brandOf(" vivo "))
    assertEquals(BatteryTargets.VIVO, BatteryTargets.brandOf("iQOO"))
    assertEquals(BatteryTargets.SAMSUNG, BatteryTargets.brandOf("samsung"))
    assertEquals("the emulator and every other phone", BatteryTargets.OTHER, BatteryTargets.brandOf("Google"))
    assertEquals(BatteryTargets.OTHER, BatteryTargets.brandOf(""))
  }

  @Test
  fun everyBrandButOtherHasItsOwnAutostartScreen() {
    assertEquals(
        listOf("com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        BatteryTargets.autostartScreens(BatteryTargets.XIAOMI),
    )
    for (brand in listOf(BatteryTargets.OPPO, BatteryTargets.VIVO, BatteryTargets.SAMSUNG)) {
      assertTrue(brand + " has screens to try", BatteryTargets.autostartScreens(brand).isNotEmpty())
    }
    assertTrue("another phone has none: its settings screen opens", BatteryTargets.autostartScreens(BatteryTargets.OTHER).isEmpty())
  }

  @Test
  fun theBrandsAreThePagesWords() {
    // The shell's checklist (src/battery-steps.ts BATTERY_BRANDS) is keyed by these.
    assertEquals(listOf("xiaomi", "oppo", "vivo", "samsung", "other"), listOf(BatteryTargets.XIAOMI, BatteryTargets.OPPO, BatteryTargets.VIVO, BatteryTargets.SAMSUNG, BatteryTargets.OTHER))
  }
}
