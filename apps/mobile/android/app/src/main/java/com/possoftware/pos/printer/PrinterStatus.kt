package com.possoftware.pos.printer

/**
 * Phase 3 Session 3C (spec §10): what a printer says of itself, read with ESC/POS real-time status (DLE EOT n) after each
 * job and while it is idle. Pure (no Android), so the parsing is unit-tested on the JVM. A printer that does not answer
 * reports nothing more: no false problem.
 */
data class PrinterHealth(
    /** [DleEot.PAPER_OK], [DleEot.PAPER_LOW] or [DleEot.PAPER_OUT]; null when the printer did not say. */
    val paper: String? = null,
    /** [DleEot.COVER_CLOSED] or [DleEot.COVER_OPEN]; null when the printer did not say. */
    val cover: String? = null,
    /** It says it cannot print and names an error, or names no cause at all (an error bit while it says it can print
     *  says nothing). */
    val error: Boolean = false,
    /** It says it cannot print now (DLE EOT 1, bit 3; or paper out or the cover open when it did not answer that). */
    val offline: Boolean = false,
) {
  /** It cannot print now: out of paper, its cover open, or an error. The page's rule is the same
   *  (apps/cafe/lib/printer/native-pool.ts poolPrinterCannotPrint), so neither holds a slip the other would print. */
  fun cannotPrint(): Boolean = paper == DleEot.PAPER_OUT || cover == DleEot.COVER_OPEN || error
}

/** ESC/POS real-time status: DLE EOT n, one status byte back (Epson's bits; most thermal printers follow them). */
object DleEot {
  // The values bridge v2 sends for a listed printer's paper and cover (pinned to the page's in
  // apps/cafe/lib/printer/native-bridge-v2-parity.test.ts).
  const val PAPER_OK = "ok"
  const val PAPER_LOW = "low"
  const val PAPER_OUT = "out"
  const val COVER_CLOSED = "closed"
  const val COVER_OPEN = "open"

  private const val DLE = 0x10
  private const val EOT = 0x04

  /** Printer status, offline cause, error cause, roll paper sensor: asked in this order. */
  val QUERIES: IntArray = intArrayOf(1, 2, 3, 4)

  // Every status byte has bits 1 and 4 set and bits 0 and 7 clear.
  private const val FIXED_MASK = 0x93
  private const val FIXED_BITS = 0x12
  private const val ONE_OFFLINE = 0x08
  private const val TWO_COVER_OPEN = 0x04
  private const val TWO_PAPER_END = 0x20
  private const val TWO_ERROR = 0x40
  private const val THREE_ERRORS = 0x68
  private const val FOUR_NEAR_END = 0x0C
  private const val FOUR_END = 0x60

  fun request(n: Int): ByteArray = byteArrayOf(DLE.toByte(), EOT.toByte(), n.toByte())

  /** Whether [b] (0..255) can be a status byte; anything else (an automatic status block, XON/XOFF, noise) is not one. */
  fun isAnswer(b: Int): Boolean = (b and FIXED_MASK) == FIXED_BITS

  /** What the printer said: [answers] maps each n it answered to its byte. Null when it answered none. */
  fun healthOf(answers: Map<Int, Int>): PrinterHealth? {
    if (answers.isEmpty()) return null
    val one = answers[1]
    val two = answers[2]
    val three = answers[3]
    val four = answers[4]
    val paperOut = (two != null && (two and TWO_PAPER_END) != 0) || (four != null && (four and FOUR_END) == FOUR_END)
    val paperLow = four != null && (four and FOUR_NEAR_END) == FOUR_NEAR_END
    val paper =
        when {
          paperOut -> PAPER_OUT
          paperLow -> PAPER_LOW
          two != null || four != null -> PAPER_OK
          else -> null
        }
    val coverOpen = two != null && (two and TWO_COVER_OPEN) != 0
    val cover = if (two == null) null else if (coverOpen) COVER_OPEN else COVER_CLOSED
    val offline = if (one != null) (one and ONE_OFFLINE) != 0 else paperOut || coverOpen
    val named = (three != null && (three and THREE_ERRORS) != 0) || (two != null && (two and TWO_ERROR) != 0)
    return PrinterHealth(paper, cover, offline && (named || (!paperOut && !coverOpen)), offline)
  }
}
