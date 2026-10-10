package com.possoftware.pos.printer

import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/**
 * Fakes for the JVM unit tests of the printer pool (Phase 2 Session 2F2, spec §13): a hand-cranked io executor, a
 * virtual-time timer, a transport whose open and write do what a test says, and the platform as a [PrinterEnv].
 */

/** A printer's io thread, run by hand: [runAll] runs what was queued (and what that queues). */
class ManualIo : AbstractExecutorService() {
  private val queue = ArrayDeque<Runnable>()
  private var down = false

  override fun execute(command: Runnable) {
    if (down) throw RejectedExecutionException("shut down")
    queue.addLast(command)
  }

  fun pending(): Int = queue.size

  fun runAll() {
    while (queue.isNotEmpty()) queue.removeFirst().run()
  }

  override fun shutdown() {
    down = true
  }

  override fun shutdownNow(): MutableList<Runnable> {
    down = true
    val left = queue.toMutableList()
    queue.clear()
    return left
  }

  override fun isShutdown(): Boolean = down

  override fun isTerminated(): Boolean = down && queue.isEmpty()

  override fun awaitTermination(timeout: Long, unit: TimeUnit): Boolean = isTerminated
}

/** A transport that records what happened to it; [onOpen] and [onWrite] decide the outcome. */
class FakeTransport(val listener: LinkListener) : PrinterTransport {
  var onOpen: () -> Unit = {}
  var onWrite: (ByteArray) -> Unit = {}
  /** Session 3C: what the printer says of itself (DLE EOT); throw to lose the link. */
  var onStatus: () -> PrinterHealth? = { null }
  val written = ArrayList<ByteArray>()
  var closed = 0
  var statusCalls = 0

  override fun open() = onOpen()

  override fun write(data: ByteArray) {
    onWrite(data)
    written.add(data)
  }

  override fun close() {
    closed++
  }

  override fun status(): PrinterHealth? {
    statusCalls++
    return onStatus()
  }
}

/** The platform: Bluetooth, the screen, the transports and a timer on virtual time. */
class FakeEnv : PrinterEnv {
  private class Task(val at: Long, val task: Runnable) {
    var cancelled = false
    var ran = false
  }

  var now = 0L
  var bluetooth = true
  var shown = true
  var changes = 0
  /** The 3C review gate: runs at every [changed], as the page hears it (a test may print from it). */
  var onChanged: () -> Unit = {}
  /** What the next transport's open does (throw to fail it); every transport made, in order. */
  var nextOpen: () -> Unit = {}
  var nextWrite: (ByteArray) -> Unit = {}
  var nextStatus: () -> PrinterHealth? = { null }
  val made = ArrayList<FakeTransport>()
  /** Session 3C (M-5): every task ever scheduled, so a test can run one as if the timer had started it already. */
  val scheduled = ArrayList<Runnable>()
  val onTimerRuns = ArrayList<Runnable>()
  private val tasks = ArrayList<Task>()

  override fun bluetoothOn(): Boolean = bluetooth

  override fun visible(): Boolean = shown

  override fun transport(info: PrinterInfo, listener: LinkListener): PrinterTransport {
    val t = FakeTransport(listener)
    t.onOpen = nextOpen
    t.onWrite = nextWrite
    t.onStatus = nextStatus
    made.add(t)
    return t
  }

  override fun schedule(delayMs: Long, task: Runnable): Cancel {
    val entry = Task(now + delayMs, task)
    tasks.add(entry)
    scheduled.add(task)
    return Cancel {
      if (entry.ran || entry.cancelled) {
        false
      } else {
        entry.cancelled = true
        true
      }
    }
  }

  override fun onTimer(task: Runnable) {
    onTimerRuns.add(task)
  }

  override fun decode(base64: String): ByteArray? = if (base64 == "!") null else base64.toByteArray()

  override fun changed() {
    changes++
    onChanged()
  }

  /** The delays (from now) of the timer tasks still waiting. */
  fun waiting(): List<Long> = tasks.filter { !it.cancelled && !it.ran }.map { it.at - now }

  /** Moves virtual time on by [ms], running every timer task that falls due, in order. */
  fun advance(ms: Long) {
    val end = now + ms
    while (true) {
      val next = tasks.filter { !it.cancelled && !it.ran && it.at <= end }.minByOrNull { it.at } ?: break
      now = next.at
      next.ran = true
      next.task.run()
    }
    now = end
  }
}

fun tcpPrinter(port: Int = 9100): PrinterInfo =
    PrinterInfo("tcp:10.0.2.2:$port", "Network printer 10.0.2.2", BridgeCodes.TRANSPORT_TCP, "10.0.2.2:$port")

fun btPrinter(): PrinterInfo =
    PrinterInfo("bt-classic:00:11:22:33:44:55", "RPP02N", BridgeCodes.TRANSPORT_BT_CLASSIC, "00:11:22:33:44:55")

fun usbPrinter(): PrinterInfo = PrinterInfo("usb:04b8:0e15", "USB printer", BridgeCodes.TRANSPORT_USB)

/** The answers a callback got, in order. */
class Replies<T> {
  val got = ArrayList<Reply<T>>()
  val cb: ReplyCallback<T> = { got.add(it) }

  fun codes(): List<String> = got.map { if (it is Reply.Err) it.code else "OK" }
}
