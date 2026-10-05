package com.possoftware.pos.printer

/**
 * What one printer's [PrinterManager] needs from the platform (Phase 2 Session 2F2, spec §13). The app's own is
 * [PrinterPool]'s (Android: Bluetooth, the transports, the timer thread, the page); the JVM unit tests pass a fake,
 * so the state machine (backoff, pause flags, per-printer busy) is tested with no device.
 */
interface PrinterEnv {
  /** Bluetooth is on and this app may use it. */
  fun bluetoothOn(): Boolean

  /** The app is on screen (a USB permission dialog can show). */
  fun visible(): Boolean

  /** A new, unopened transport for [info]; throws [TransportException] BAD_REQUEST for a bad id. */
  fun transport(info: PrinterInfo, listener: LinkListener): PrinterTransport

  /** Runs [task] on the timer thread after [delayMs]. */
  fun schedule(delayMs: Long, task: Runnable): Cancel

  /** Runs [task] on the timer thread soon. */
  fun onTimer(task: Runnable)

  /** The bytes of a print job, or null when it is not base64. */
  fun decode(base64: String): ByteArray?

  /** Something a page reads about this printer changed: the pool publishes (it de-duplicates). */
  fun changed()
}

/** A scheduled task. [cancel] is true only when it stopped the task before it started. */
fun interface Cancel {
  fun cancel(): Boolean
}
