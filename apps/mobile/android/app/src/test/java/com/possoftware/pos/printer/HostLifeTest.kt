package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 Session 3D (spec §9.5): when the print host service runs, and when a device that prints for the cafe says "POS
 * printing is off. Tap to start." (after Android restarted the service, a stop the page did not ask for, a reboot or an
 * update of the app).
 */
class HostLifeTest {
  @Test
  fun aStartThePageAskedForRunsWhateverWasSaved() {
    assertEquals(HostLife.Start.RUN, HostLife.onStart(HostLife.ACTION_START, printing = false))
    assertEquals(HostLife.Start.RUN, HostLife.onStart(HostLife.ACTION_START, printing = true))
  }

  @Test
  fun aRestartAfterTheProcessDiedSaysPrintingIsOffThenStops() {
    // START_STICKY: Android re-creates the service with no intent; the page died with the process, so nothing prints.
    assertEquals(HostLife.Start.NOTICE_THEN_STOP, HostLife.onStart(null, printing = true))
    assertEquals("a device the page no longer prints on stops silently", HostLife.Start.STOP, HostLife.onStart(null, printing = false))
  }

  @Test
  fun aStopThePageDidNotAskForSaysPrintingIsOff() {
    assertTrue("the task swiped away, the screen destroyed", HostLife.noticeOnStop(printing = true))
    assertFalse("the page said stop (it cleared the wish first)", HostLife.noticeOnStop(printing = false))
  }

  @Test
  fun aRebootOrAnUpdateSaysPrintingIsOffOnlyOnADeviceThatPrinted() {
    assertTrue(HostLife.noticeOnBroadcast(HostLife.ACTION_BOOT_COMPLETED, printing = true))
    assertTrue(HostLife.noticeOnBroadcast(HostLife.ACTION_MY_PACKAGE_REPLACED, printing = true))
    assertFalse("a device that does not print for the cafe stays quiet", HostLife.noticeOnBroadcast(HostLife.ACTION_BOOT_COMPLETED, printing = false))
    assertFalse("nothing else", HostLife.noticeOnBroadcast("android.intent.action.TIME_SET", printing = true))
    assertEquals("the system's own actions", "android.intent.action.BOOT_COMPLETED", HostLife.ACTION_BOOT_COMPLETED)
    assertEquals("android.intent.action.MY_PACKAGE_REPLACED", HostLife.ACTION_MY_PACKAGE_REPLACED)
  }
}
