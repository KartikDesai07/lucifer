package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Publish de-duplication per bridge version and the print-host notification's worst state (Phase 2 Session 2F2,
 * spec §9.2).
 */
class PoolStatusTest {
  private val kitchen = tcpPrinter(9100)
  private val bar = tcpPrinter(9101)

  private fun one(state: String, printer: PrinterInfo?): StatusSnapshot = StatusSnapshot(state, printer, BridgeCodes.BT_ON)

  private fun all(defaultId: String?, vararg entries: Pair<PrinterInfo, String>): PoolSnapshot =
      PoolSnapshot(entries.map { PoolEntry(it.second, it.first) }, defaultId, BridgeCodes.BT_ON)

  @Test
  fun eachVersionsEventGoesOutOnlyWhenWhatItCarriesChanged() {
    val dedupe = StatusDedupe()
    val c = BridgeCodes.STATE_CONNECTED
    val d = BridgeCodes.STATE_DISCONNECTED
    assertEquals("the first publish: both", StatusDedupe.Changes(v1 = true, v2 = true), dedupe.next(one(c, kitchen), all(kitchen.id, kitchen to c, bar to c)))
    assertEquals("nothing changed: none", StatusDedupe.Changes(v1 = false, v2 = false), dedupe.next(one(c, kitchen), all(kitchen.id, kitchen to c, bar to c)))
    assertEquals("another printer's state: v2 only", StatusDedupe.Changes(v1 = false, v2 = true), dedupe.next(one(c, kitchen), all(kitchen.id, kitchen to c, bar to d)))
    assertEquals("the default's state: both", StatusDedupe.Changes(v1 = true, v2 = true), dedupe.next(one(d, kitchen), all(kitchen.id, kitchen to d, bar to d)))
    assertEquals("a new default: both", StatusDedupe.Changes(v1 = true, v2 = true), dedupe.next(one(d, bar), all(bar.id, bar to d)))
    assertEquals("the last printer gone", StatusDedupe.Changes(v1 = true, v2 = true), dedupe.next(one(BridgeCodes.STATE_NONE, null), all(null)))
  }

  @Test
  fun theNotificationSaysTheWorstStateAcrossPrinters() {
    val c = BridgeCodes.STATE_CONNECTED
    val d = BridgeCodes.STATE_DISCONNECTED
    val k = BridgeCodes.STATE_CONNECTING
    val third = tcpPrinter(9102)
    assertEquals("no printer", HostTitle.NotConnected, HostTitle.of(all(null)))
    assertEquals("the only printer, connected: its name, as before", HostTitle.Printer(kitchen.name), HostTitle.of(all(kitchen.id, kitchen to c)))
    assertEquals("the only printer, down: the words of one printer", HostTitle.NotConnected, HostTitle.of(all(kitchen.id, kitchen to d)))
    assertEquals("every printer connected", HostTitle.AllConnected(2), HostTitle.of(all(kitchen.id, kitchen to c, bar to c)))
    assertEquals("one of several down, connecting counted as down", HostTitle.OneDown(bar.name), HostTitle.of(all(kitchen.id, kitchen to c, bar to k)))
    assertEquals("several down", HostTitle.SomeDown(2), HostTitle.of(all(kitchen.id, kitchen to d, bar to c, third to d)))
  }

  // Phase 3 Session 3C (spec §10): a printer's paper, cover or error changes the v2 event only, and out of paper is the
  // notification's worst state.
  @Test
  fun aPrintersStatusChangesTheV2EventOnlyAndOutOfPaperIsTheWorstTitle() {
    val c = BridgeCodes.STATE_CONNECTED
    val out = PrinterHealth(DleEot.PAPER_OUT, DleEot.COVER_CLOSED, error = false, offline = true)
    val dedupe = StatusDedupe()
    dedupe.next(one(c, kitchen), all(kitchen.id, kitchen to c))
    val empty = PoolSnapshot(listOf(PoolEntry(c, kitchen, out)), kitchen.id, BridgeCodes.BT_ON)
    assertEquals("paper out: v2 only", StatusDedupe.Changes(v1 = false, v2 = true), dedupe.next(one(c, kitchen), empty))
    assertEquals("the only printer, out of paper", HostTitle.PaperOut(kitchen.name), HostTitle.of(empty))
    val two = PoolSnapshot(listOf(PoolEntry(BridgeCodes.STATE_DISCONNECTED, bar), PoolEntry(c, kitchen, out)), kitchen.id, BridgeCodes.BT_ON)
    assertEquals("worse than a printer down", HostTitle.PaperOut(kitchen.name), HostTitle.of(two))
  }
}
