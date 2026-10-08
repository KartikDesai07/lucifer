package com.possoftware.pos.printer

/**
 * The print host's page watchdog (main thread only). Every tick scores the previous tick's probe (the page still answers),
 * then the service sends the next. [deadTicks] dead ticks while nobody looks at the app: the alert notification.
 *
 * Phase 3 Session 3D (spec §9.5): and the WebView is remounted instead of only being reported, once per page life (a page
 * that never answers again is not remounted again: no reload loop, no requests while it stays dead) and at most once
 * every [remountGapTicks] ticks. The alert stays until a page answers. Pure, so the JVM tests (src/test) pin it.
 */
class PageWatch(private val deadTicks: Int, private val remountGapTicks: Int) {
  private var issued = false
  private var answered = false
  private var dead = 0
  // The page answered since the last remount (or none was asked yet).
  private var lived = true
  private var sinceRemount = NEVER

  private companion object {
    const val NEVER = Int.MAX_VALUE
  }

  /** The service (re)started: nothing scored yet. */
  fun start() {
    issued = false
    answered = false
    dead = 0
    lived = true
    sinceRemount = NEVER
  }

  /** The page answered the probe this tick sent. */
  fun answered() {
    answered = true
  }

  /** One tick: scores the previous probe (when one went out); the service then sends the next. True: remount now. */
  fun tick(visible: Boolean): Boolean {
    if (issued) dead = if (answered) 0 else dead + 1
    if (answered) lived = true
    answered = false
    issued = true
    if (sinceRemount != NEVER) sinceRemount++
    val remount = alerting(visible) && lived && sinceRemount >= remountGapTicks
    if (remount) {
      lived = false
      sinceRemount = 0
    }
    return remount
  }

  /** The page stopped answering and nobody is looking at the app, so only a notification can say so. */
  fun alerting(visible: Boolean): Boolean = dead >= deadTicks && !visible
}

/** Phase 3 Session 3D (the gold's review, I-2): React Native mounts a remounted page while the app is hidden at most once
 *  per [gapMs], so a renderer the system keeps killing under memory pressure never turns into a reload loop on a device
 *  nobody looks at (the page then loads when the app is next opened, and the print host's alert says so). Pure. */
class HiddenMountGap(private val gapMs: Long) {
  private var lastAt: Long? = null

  fun allow(nowMs: Long): Boolean {
    val last = lastAt
    if (last != null && nowMs - last < gapMs) return false
    lastAt = nowMs
    return true
  }
}

/** Phase 3 Session 3D: the shell's side of a remount the watchdog asks for (set by the module while React Native runs). */
object HostPage {
  /** The device event the shell's POS screen remounts its WebView on (src/native/PosPrinter.ts PAGE_DEAD_EVENT). */
  const val DEAD_EVENT = "PosPageDead"

  @Volatile var remount: (() -> Unit)? = null
}
