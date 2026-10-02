package com.possoftware.pos.printer

import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Orders printer selections and runs the network-address fence. Every selection takes a ticket on
 * the timer thread, which also aborts the lookup of an older selection. A host name is resolved on
 * the [PrinterThreads.dns] thread (never the io thread) and its choice is committed only while its
 * ticket is still the newest, so a slow lookup can never overwrite a later choice.
 *
 * [ticket] and [inFlight] belong to the timer thread; only the lookup itself runs elsewhere.
 */
object SelectionFence {
  private class Pending(val ticket: Int, private val cb: ReplyCallback<StatusSnapshot>) {
    private val settled = AtomicBoolean(false)

    @Volatile var lookup: Future<*>? = null

    /** Answers the caller exactly once, whichever path gets here first. */
    fun settle(reply: Reply<StatusSnapshot>) {
      if (settled.compareAndSet(false, true)) cb(reply)
    }
  }

  private var ticket = 0
  private var inFlight: Pending? = null

  /**
   * Timer thread. Records a new selection (or a forget): the older selection's lookup is
   * cancelled and its caller is answered with the current status. Returns the new ticket.
   */
  fun begin(): Int {
    val old = inFlight
    inFlight = null
    if (old != null) {
      old.lookup?.cancel(false)
      old.settle(Reply.Ok(PrinterManager.status()))
    }
    return ++ticket
  }

  /**
   * Timer thread. Resolves [host] off-thread. A host with no private address answers [cb] with
   * BAD_REQUEST; otherwise [commit] runs (and answers [cb]) if [mine] is still the newest ticket,
   * else [cb] gets the current status.
   */
  fun check(host: String, mine: Int, cb: ReplyCallback<StatusSnapshot>, commit: () -> Unit) {
    val pending = Pending(mine, cb)
    inFlight = pending
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
              PrinterThreads.timer.execute(Runnable { finish(pending, forbidden, commit) })
            }
        )
  }

  private fun finish(pending: Pending, forbidden: Boolean, commit: () -> Unit) {
    if (pending.ticket != ticket) {
      pending.settle(Reply.Ok(PrinterManager.status()))
      return
    }
    inFlight = null
    if (forbidden) pending.settle(Reply.fail(BridgeCodes.BAD_REQUEST)) else commit()
  }
}
