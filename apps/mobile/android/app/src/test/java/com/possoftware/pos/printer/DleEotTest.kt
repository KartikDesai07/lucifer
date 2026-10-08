package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 Session 3C (spec §10): a printer's DLE EOT answers read as paper, cover, error and whether it can print. The
 * bytes are the Epson bits scripts/fake-escpos-printer.mjs answers with (and real printers send).
 */
class DleEotTest {
  @Test
  fun aRequestIsDleEotN() {
    assertEquals(listOf(0x10, 0x04, 0x02), DleEot.request(2).map { it.toInt() })
    assertEquals("printer, offline cause, error cause, roll paper", listOf(1, 2, 3, 4), DleEot.QUERIES.toList())
  }

  @Test
  fun onlyAStatusByteIsAnAnswer() {
    assertTrue("a healthy printer", DleEot.isAnswer(0x12))
    assertTrue("roll paper end", DleEot.isAnswer(0x72))
    assertFalse("an automatic status block's first byte", DleEot.isAnswer(0x10))
    assertFalse("XON", DleEot.isAnswer(0x11))
    assertFalse("XOFF", DleEot.isAnswer(0x13))
    assertFalse("bit 7 set", DleEot.isAnswer(0x92))
  }

  @Test
  fun aHealthyPrinterIsReadyWithPaperAndItsCoverClosed() {
    assertEquals(PrinterHealth(DleEot.PAPER_OK, DleEot.COVER_CLOSED, error = false, offline = false), DleEot.healthOf(mapOf(1 to 0x12, 2 to 0x12, 3 to 0x12, 4 to 0x12)))
  }

  @Test
  fun paperOutCoverOpenAndLowPaperAreRead() {
    val out = DleEot.healthOf(mapOf(1 to 0x1a, 2 to 0x32, 3 to 0x12, 4 to 0x72))
    assertEquals("the fake printer's --paper-out", PrinterHealth(DleEot.PAPER_OUT, DleEot.COVER_CLOSED, error = false, offline = true), out)
    val open = DleEot.healthOf(mapOf(1 to 0x1a, 2 to 0x16, 3 to 0x12, 4 to 0x12))
    assertEquals("--cover-open", PrinterHealth(DleEot.PAPER_OK, DleEot.COVER_OPEN, error = false, offline = true), open)
    val low = DleEot.healthOf(mapOf(1 to 0x12, 2 to 0x12, 3 to 0x12, 4 to 0x1e))
    assertEquals("--paper-low: still prints", PrinterHealth(DleEot.PAPER_LOW, DleEot.COVER_CLOSED, error = false, offline = false), low)
  }

  @Test
  fun anErrorIsWhatThePrinterNamesOrAnOfflineWithNoCauseAndOnlyWhileItCannotPrint() {
    assertEquals("offline with an autocutter error (n=3, bit 3)", true, DleEot.healthOf(mapOf(1 to 0x1a, 3 to 0x1a))?.error)
    assertEquals("an error bit while it says it can print says nothing", false, DleEot.healthOf(mapOf(1 to 0x12, 3 to 0x1a))?.error)
    val unnamed = DleEot.healthOf(mapOf(1 to 0x1a, 2 to 0x12, 4 to 0x12))
    assertEquals("offline with its paper in and its cover closed: an error, so the words say why", PrinterHealth(DleEot.PAPER_OK, DleEot.COVER_CLOSED, error = true, offline = true), unnamed)
    assertTrue("so it cannot print", unnamed!!.cannotPrint())
    assertFalse("low paper still prints", PrinterHealth(DleEot.PAPER_LOW, DleEot.COVER_CLOSED).cannotPrint())
  }

  @Test
  fun aPrinterThatAnswersNothingSaysNothingAndOneThatAnswersPartlySaysOnlyThat() {
    assertNull("no answer: no false problem", DleEot.healthOf(emptyMap()))
    assertEquals("only DLE EOT 1: ready, nothing about paper or cover", PrinterHealth(null, null, error = false, offline = false), DleEot.healthOf(mapOf(1 to 0x12)))
    assertEquals("no DLE EOT 1, paper end in n=4: it cannot print", true, DleEot.healthOf(mapOf(4 to 0x72))?.offline)
  }
}
