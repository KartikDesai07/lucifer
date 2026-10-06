package com.possoftware.pos.printer

import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Orders printer selections and runs the network-address fence. Every selection takes a ticket on the timer thread,
 * which also aborts the lookup of an older selection for the same slot. A host name is resolved on the
 * [PrinterThreads.dns] thread (never an io thread) and its choice is committed only while its ticket is still the
 * newest, so a slow lookup can never overwrite a later choice.
 *
 * Phase 2 Session 2F2: one slot per thing a selection changes: the default printer for v1 calls (""), and each
 * printer's id for v2 calls, so a page adding two network printers at once never cancels the first with the second.
 * [tickets] and [inFlight] belong to the timer thread; only the lookup itself runs elsewhere.
 */
object SelectionFence {
  private class Pending<T>(val ticket: Int, private val cb: ReplyCallback<T>, private val answer: () -> T) {
    private val settled = AtomicBoolean(false)

    @Volatile var lookup: Future<*>? = null

    /** Answers the caller exactly once, whichever path gets here first. */
    fun settle(reply: Reply<T>) {
      if (settled.compareAndSet(false, true)) cb(reply)
    }

    /** A newer selection for this slot won: the caller gets the current status, in its own version's shape. */
    fun superseded() = settle(Reply.Ok(answer()))
  }

  private val tickets = HashMap<String, Int>()
  private val inFlight = HashMap<String, Pending<*>>()

  /**
   * Timer thread. Records a new selection (or a forget) for [slot]: the older selection's lookup is cancelled and its
   * caller is answered with the current status. Returns the new ticket.
   */
  fun begin(slot: String): Int {
    val old = inFlight.remove(slot)
    if (old != null) {
      old.lookup?.cancel(false)
      old.superseded()
    }
    val next = (tickets[slot] ?: 0) + 1
    tickets[slot] = next
    return next
  }

  /**
   * Timer thread. Resolves [host] off-thread. A host with no private address answers [cb] with BAD_REQUEST; otherwise
   * [commit] runs (and answers [cb]) if [mine] is still the newest ticket of [slot], else [cb] gets [answer].
   */
  fun <T> check(host: String, slot: String, mine: Int, cb: ReplyCallback<T>, answer: () -> T, commit: () -> Unit) {
    val pending = Pending(mine, cb, answer)
    inFlight[slot] = pending
    pending.lookup =
        PrinterThreads.dns.submit(
            Runnable {
              val forbidden =
                  try {
                    TcpAddress.isForbidden(host)
                  } catch (e: RuntimeException) {
                    // The connect re-checks the address, so an odd resolver failure is not final here.
                    false
                  }
              PrinterThreads.timer.execute(Runnable { finish(slot, pending, forbidden, commit) })
            }
        )
  }

  private fun <T> finish(slot: String, pending: Pending<T>, forbidden: Boolean, commit: () -> Unit) {
    if (pending.ticket != tickets[slot]) {
      pending.superseded()
      return
    }
    inFlight.remove(slot)
    if (forbidden) pending.settle(Reply.fail(BridgeCodes.BAD_REQUEST)) else commit()
  }
}
