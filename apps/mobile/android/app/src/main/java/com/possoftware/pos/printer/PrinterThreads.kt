package com.possoftware.pos.printer

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService

/**
 * The worker threads. [io] may block for a long time (connect, write); [timer] never blocks;
 * [dns] only resolves host names for the network-printer fence, so a slow resolver can never hold
 * up a print job or a reconnect on [io].
 */
object PrinterThreads {
  private fun daemon(r: Runnable, name: String): Thread {
    val thread = Thread(r, name)
    thread.isDaemon = true
    return thread
  }

  val io: ScheduledExecutorService =
      Executors.newSingleThreadScheduledExecutor { r -> daemon(r, "pos-printer-io") }
  val timer: ScheduledExecutorService =
      Executors.newSingleThreadScheduledExecutor { r -> daemon(r, "pos-printer-timer") }
  val dns: ExecutorService =
      Executors.newSingleThreadExecutor { r -> daemon(r, "pos-printer-dns") }
}
