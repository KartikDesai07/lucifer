package com.possoftware.pos.printer

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.atomic.AtomicInteger

/**
 * The worker threads. A printer's io thread ([newIo]) may block for a long time (connect, write); [timer] never
 * blocks; [dns] only resolves host names for the network-printer fence, so a slow resolver can never hold up a
 * print job or a reconnect. Phase 2 Session 2F2 (spec §9.2): every printer has an io thread of its own, so a blocked
 * Bluetooth Classic connect or a USB permission wait on one printer never stalls another.
 */
object PrinterThreads {
  private fun daemon(r: Runnable, name: String): Thread {
    val thread = Thread(r, name)
    thread.isDaemon = true
    return thread
  }

  private val ioCount = AtomicInteger(0)

  /** A new printer's own io thread (its [PrinterManager] shuts it down when the printer leaves the list). */
  fun newIo(): ExecutorService =
      Executors.newSingleThreadExecutor { r -> daemon(r, "pos-printer-io-" + ioCount.incrementAndGet()) }

  val timer: ScheduledExecutorService =
      Executors.newSingleThreadScheduledExecutor { r -> daemon(r, "pos-printer-timer") }
  val dns: ExecutorService =
      Executors.newSingleThreadExecutor { r -> daemon(r, "pos-printer-dns") }
}
