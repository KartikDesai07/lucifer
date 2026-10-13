package com.possoftware.pos.update

/**
 * Native apps 2.0 (spec §6.2, §6.3): when the updater may look for an update and when the card may show. Both happen only
 * at an **app open**: the first time the app is seen after its process started, or when it comes back after at least
 * [reopenAfterMs] out of view (30 minutes). At an open the updater looks for an update when its last look is
 * [checkEveryMs] old (12 hours). The card shows at most once per open, and only for an APK verified **before** that
 * open: a download that ends while staff are working waits for the next open, and an open's card not taken before the
 * app went out of view is dropped, so the card never appears in the middle of work. "Later" needs no state: the next
 * open offers the card again.
 *
 * Pure: the caller passes the clocks (SystemClock.elapsedRealtime() for [shown] and [hidden]; wall time for [checkDue],
 * because the last check is kept across restarts). Main thread only. The JVM tests (src/test) pin it.
 */
class UpdateSchedule(
    private val installedCode: Int,
    private val checkEveryMs: Long = CHECK_EVERY_MS,
    private val reopenAfterMs: Long = REOPEN_AFTER_MS,
) {
  companion object {
    const val CHECK_EVERY_MS = 12 * 60 * 60 * 1000L
    const val REOPEN_AFTER_MS = 30 * 60 * 1000L
  }

  private var seen = false
  private var hiddenAt: Long? = null
  private var cardCode: Int? = null

  /** The app came into view at [elapsedMs]. [verifiedCode]: the version code of the update downloaded and verified so
   *  far (null: none). True when this is an app open. */
  fun shown(elapsedMs: Long, verifiedCode: Int?): Boolean {
    val away = hiddenAt
    val open = !seen || (away != null && elapsedMs - away >= reopenAfterMs)
    seen = true
    hiddenAt = null
    if (open) cardCode = verifiedCode?.takeIf { it > installedCode }
    return open
  }

  /** The app went out of view at [elapsedMs] (the first of onPause and onStop counts). An open's card not taken by now
   *  waits for the next open. */
  fun hidden(elapsedMs: Long) {
    if (hiddenAt == null) hiddenAt = elapsedMs
    cardCode = null
  }

  /** At an open: look for an update now? [lastCheckMs] is wall time, 0 when never. A clock set back counts as due. */
  fun checkDue(nowMs: Long, lastCheckMs: Long): Boolean =
      lastCheckMs <= 0L || nowMs - lastCheckMs >= checkEveryMs || nowMs < lastCheckMs

  /** The card for this open, handed out once: the version code to offer, or null. */
  fun takeCard(): Int? {
    val code = cardCode
    cardCode = null
    return code
  }
}
