package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 Session 3D (spec §9.5): the print host's page watchdog. Two dead ticks while nobody looks at the app: the alert,
 * and a remount of the WebView, once per page life and at most once every 40 ticks (10 minutes at 15 s).
 */
class PageWatchTest {
  private fun watch() = PageWatch(deadTicks = 2, remountGapTicks = 40).also { it.start() }

  /** [n] ticks whose probes the page did not answer; the remounts asked on the way. */
  private fun dead(w: PageWatch, n: Int, visible: Boolean = false): Int = (1..n).count { w.tick(visible) }

  private fun alive(w: PageWatch, visible: Boolean = false): Boolean {
    w.answered()
    return w.tick(visible)
  }

  @Test
  fun aPageThatStopsAnsweringWhileHiddenIsRemountedOnceAndAlerted() {
    val w = watch()
    assertFalse("the first tick only sends a probe", w.tick(false))
    assertFalse("one dead tick: nothing yet", w.tick(false))
    assertTrue("two dead ticks while hidden: remount", w.tick(false))
    assertTrue("and the alert shows", w.alerting(false))
    assertEquals("a page that never answers again is not remounted again", 0, dead(w, 100))
    assertTrue("the alert stays", w.alerting(false))
  }

  @Test
  fun aPageThatAnswersAgainIsAliveAndADeathLaterIsRemountedAfterTenMinutes() {
    val w = watch()
    w.tick(false)
    assertEquals(1, dead(w, 2))
    assertFalse("the new page answers: alive", alive(w))
    assertFalse("the alert goes", w.alerting(false))
    assertEquals("it dies again within 10 minutes: no second remount yet", 0, dead(w, 10))
    assertEquals("10 minutes after the last remount: once more", 1, dead(w, 30))
  }

  @Test
  fun aVisibleAppIsNeverRemountedByTheWatchdog() {
    val w = watch()
    w.tick(true)
    assertEquals("staff are looking at the app: it is theirs to reload", 0, dead(w, 10, visible = true))
    assertFalse(w.alerting(true))
  }

  @Test
  fun aHiddenMountIsAllowedAtMostOnceEveryTenMinutes() {
    // The gold's review (I-2): a renderer killed again and again while hidden never becomes a reload loop.
    val gap = HiddenMountGap(gapMs = 600_000L)
    assertTrue("the first page death mounts at once", gap.allow(1_000L))
    assertFalse("another within 10 minutes waits for the app to be opened", gap.allow(1_000L + 599_999L))
    assertTrue("10 minutes after the last one: once more", gap.allow(1_000L + 600_000L))
  }

  @Test
  fun anAnswerEndsTheAlertAtOnce() {
    // The 3D review gate (m-3): a page that heals after a remount puts "Printing is on" back when it answers, not a tick later.
    val w = watch()
    w.tick(false)
    assertEquals(1, dead(w, 2))
    assertTrue("two dead ticks while hidden: the alert", w.alerting(false))
    w.answered()
    assertFalse("the new page answered: the alert goes at once", w.alerting(false))
  }

  @Test
  fun aNewRunStartsClean() {
    val w = watch()
    w.tick(false)
    assertEquals(1, dead(w, 2))
    w.start()
    assertFalse("the first tick after a start only sends a probe", w.tick(false))
    assertFalse(w.alerting(false))
    assertEquals("a death in the new run is remounted at once (it is a new page life)", 1, dead(w, 2))
  }
}
