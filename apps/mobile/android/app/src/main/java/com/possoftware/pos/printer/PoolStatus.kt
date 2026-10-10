package com.possoftware.pos.printer

/**
 * Publish de-duplication (Phase 2 Session 2F2; pure, unit-tested): each bridge version's printer.status event goes
 * out only when what it carries changed, since every event nudges the page's print agent. The v1 event carries the
 * default printer's status, so it follows every change of the default (a select into an empty list, a promotion
 * after a forget, a v1 select or forget) and of its state; the v2 event carries every printer. The pool's publish
 * lock guards it.
 */
class StatusDedupe {
  private var lastV1: StatusSnapshot? = null
  private var lastV2: PoolSnapshot? = null

  /** Which events [v1] and [v2] need; both are remembered as published. */
  fun next(v1: StatusSnapshot, v2: PoolSnapshot): Changes {
    val changes = Changes(v1 != lastV1, v2 != lastV2)
    lastV1 = v1
    lastV2 = v2
    return changes
  }

  data class Changes(val v1: Boolean, val v2: Boolean)
}

/** What the print-host notification's title says: the worst state across the app's printers (pure, unit-tested).
 *  Session 3C (spec §10): a connected printer that says it is out of paper is the worst of all. */
sealed class HostTitle {
  /** A connected printer says it is out of paper (DLE EOT). */
  data class PaperOut(val name: String) : HostTitle()

  /** No printer, or the only printer is not connected: the words of an app with one printer. */
  object NotConnected : HostTitle()

  /** The only printer, connected. */
  data class Printer(val name: String) : HostTitle()

  /** Every one of several printers is connected. */
  data class AllConnected(val count: Int) : HostTitle()

  /** One of several printers is not connected. */
  data class OneDown(val name: String) : HostTitle()

  /** Several printers are not connected. */
  data class SomeDown(val count: Int) : HostTitle()

  companion object {
    fun of(pool: PoolSnapshot): HostTitle {
      val down = pool.printers.filter { it.state != BridgeCodes.STATE_CONNECTED }
      val empty = pool.printers.firstOrNull { it.state == BridgeCodes.STATE_CONNECTED && it.health?.paper == DleEot.PAPER_OUT }
      return when {
        empty != null -> PaperOut(empty.printer.name)
        pool.printers.isEmpty() -> NotConnected
        pool.printers.size == 1 -> if (down.isEmpty()) Printer(pool.printers[0].printer.name) else NotConnected
        down.isEmpty() -> AllConnected(pool.printers.size)
        down.size == 1 -> OneDown(down[0].printer.name)
        else -> SomeDown(down.size)
      }
    }
  }
}
