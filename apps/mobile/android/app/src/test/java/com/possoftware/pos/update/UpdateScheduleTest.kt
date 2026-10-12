package com.possoftware.pos.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Native apps 2.0 (spec §6.2, §6.3): the updater acts only at an app open (the first view after the process started, or
 * back after 30 minutes away), looks at most every 12 hours, and offers the card once per open, only for an APK verified
 * before that open: never in the middle of work.
 */
class UpdateScheduleTest {
  private val min = 60_000L
  private val hour = 60 * min

  private fun schedule() = UpdateSchedule(installedCode = 20000)

  @Test
  fun theFirstViewAfterTheProcessStartedIsAnOpen() {
    val s = schedule()
    assertTrue(s.shown(5_000L, null))
    s.hidden(10_000L)
    assertFalse("back after a few seconds: the same open", s.shown(15_000L, null))
  }

  @Test
  fun backAfterThirtyMinutesAwayIsAnOpenSoonerIsNot() {
    val s = schedule()
    s.shown(0L, null)
    s.hidden(1 * min)
    assertFalse("29:59 away", s.shown(1 * min + 30 * min - 1, null))
    s.hidden(40 * min)
    assertTrue("30:00 away", s.shown(70 * min, null))
  }

  @Test
  fun theFirstMomentAwayCounts() {
    // onPause, then onStop later: the app went away at the first.
    val s = schedule()
    s.shown(0L, null)
    s.hidden(1 * min)
    s.hidden(20 * min)
    assertTrue(s.shown(31 * min, null))
  }

  @Test
  fun aCheckRunsAtAnOpenWhenTheLastIsTwelveHoursOld() {
    val s = schedule()
    val last = 1_760_000_000_000L
    assertTrue("never looked", s.checkDue(last, 0L))
    assertFalse("11:59 later", s.checkDue(last + 12 * hour - 1, last))
    assertTrue("12:00 later", s.checkDue(last + 12 * hour, last))
    assertTrue("a clock set back still looks, never stuck until the clock catches up", s.checkDue(last - hour, last))
  }

  @Test
  fun theCardIsOfferedOncePerOpenAndAgainAtTheNextOpen() {
    val s = schedule()
    s.shown(0L, 20100)
    assertEquals(20100, s.takeCard())
    assertNull("once per open", s.takeCard())
    s.hidden(1 * min)
    s.shown(31 * min, 20100)
    assertEquals("Later: the next open offers it again", 20100, s.takeCard())
  }

  @Test
  fun aDownloadThatEndsDuringWorkWaitsForTheNextOpen() {
    val s = schedule()
    s.shown(0L, null)
    assertNull(s.takeCard())
    // The download is verified a few minutes in; staff keep working, step away for 5 minutes and come back.
    s.hidden(10 * min)
    assertFalse(s.shown(15 * min, 20100))
    assertNull("not an open: no card in the middle of work", s.takeCard())
    s.hidden(60 * min)
    assertTrue(s.shown(120 * min, 20100))
    assertEquals(20100, s.takeCard())
  }

  @Test
  fun aCardNotTakenBeforeTheAppWentAwayWaitsForTheNextOpen() {
    val s = schedule()
    s.shown(0L, 20100)
    s.hidden(1_000L)
    assertFalse(s.shown(2 * min, 20100))
    assertNull("never later in a session", s.takeCard())
  }

  @Test
  fun anUpdateNoNewerThanTheInstalledAppIsNeverACard() {
    val s = schedule()
    s.shown(0L, 20000)
    assertNull(s.takeCard())
  }
}
