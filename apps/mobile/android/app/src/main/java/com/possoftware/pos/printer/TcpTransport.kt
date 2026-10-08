package com.possoftware.pos.printer

import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Raw TCP link to a network printer (normally port 9100). There is no standing connection: every
 * job connects, writes, half-closes and closes, so a printer that was switched off or lost its
 * address can never swallow a slip. [open] is only a connect probe that makes the status honest.
 *
 * Phase 3 Session 3C (spec §10, G5): a job asks DLE EOT on its own connection before it reads printed,
 * and [status] is the idle check (one connect, DLE EOT, close). [afterJobMinMs] and [replyMs] are the
 * waits; the JVM tests pass short ones.
 */
class TcpTransport(
    private val host: String,
    private val port: Int,
    private val afterJobMinMs: Int = STATUS_AFTER_JOB_MIN_MS,
    private val replyMs: Int = STATUS_REPLY_MS,
) : PrinterTransport {

  companion object {
    const val CONNECT_TIMEOUT_MS = 5_000
    const val DRAIN_TIMEOUT_MS = 750
    const val CHUNK_BYTES = 4_096
    const val RX_BUFFER_BYTES = 64

    /** A socket timeout of 0 means "wait forever", so no wait is ever shorter than this. */
    const val MIN_WAIT_MS = 1

    /** The 3C review gate (its review's I-1): a connect that failed at once (refused, or its host unreachable: Android
     *  reports both as ConnectException) is tried once more this much later, inside [CONNECT_TIMEOUT_MS]. A printer that
     *  takes one connection at a time refuses a second one while another device's status check holds it (a fraction of
     *  a second); a job must not read that as "unreachable". A printer that is off times out instead: no retry. */
    const val CONNECT_REFUSED_RETRY_MS = 1_000
    private const val REFUSED = "Refused"

    /** Session 3C (G5): the wait for the printer's first DLE EOT answer after a job: at least this, plus the job's own
     *  printing time at a slow [STATUS_BYTES_PER_MS], at most [STATUS_AFTER_JOB_MAX_MS] (inside the 60 s watchdog). */
    const val STATUS_AFTER_JOB_MIN_MS = 5_000
    const val STATUS_AFTER_JOB_MAX_MS = 30_000
    const val STATUS_BYTES_PER_MS = 8

    /** Session 3C: a DLE EOT answer from a printer with nothing to print. */
    const val STATUS_REPLY_MS = 1_000

    /** Session 3C (the gate's review, m-7): DLE EOT 2 to 4, once the printer answered DLE EOT 1 (it answers in ms). */
    const val STATUS_FOLLOW_UP_MS = 300

    private const val NO_ANSWER = -1
    private const val CLOSED = -2

    /** The printers (host:port) that answered DLE EOT since the app started. Only for such a printer is a job with no
     *  answer, or a connection closed before the answer, "maybe" (G5); one that never answers prints as before (no false
     *  problem, no false REPRINT: some close the connection after every job). An idle check with no answer forgets it
     *  (a printer replaced by one that does not answer). */
    private val answering: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** The printers whose last idle check got no answer: a job asks them briefly ([replyMs]), never the long wait (the
     *  gate's review, I-2: a silent printer would add seconds to every slip and ring the KOT alarm). */
    private val silent: MutableSet<String> = ConcurrentHashMap.newKeySet()
  }

  private val closing = AtomicBoolean(false)
  @Volatile private var active: Socket? = null
  private val key = "$host:$port"

  // What the last job's own connection read (G5), handed to the next status() instead of a second connection.
  @Volatile private var jobAsked = false
  @Volatile private var jobHealth: PrinterHealth? = null

  /** Connect probe: the printer answers now, or this throws NOT_CONNECTED. */
  override fun open() {
    closeSocket(connect())
  }

  override fun write(data: ByteArray) {
    val s = connect()
    try {
      val stream = s.getOutputStream()
      var offset = 0
      while (offset < data.size) {
        val count = minOf(CHUNK_BYTES, data.size - offset)
        stream.write(data, offset, count)
        offset += count
      }
      stream.flush()
      afterJob(s, data.size)
      s.shutdownOutput()
      drain(s)
    } catch (e: TransportException) {
      throw e
    } catch (e: IOException) {
      throw TransportException(BridgeCodes.WRITE_FAILED, "Write failed")
    } finally {
      closeSocket(s)
    }
  }

  /**
   * Reads until the printer closes or [DRAIN_TIMEOUT_MS] has passed in total, so unread status
   * bytes never reset the link. The end time is fixed once: a printer that keeps sending bytes
   * cannot stretch the drain, because every read only gets the time that is left.
   */
  private fun drain(s: Socket) {
    val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DRAIN_TIMEOUT_MS.toLong())
    try {
      val buffer = ByteArray(RX_BUFFER_BYTES)
      val input = s.getInputStream()
      while (true) {
        val left = remainingMs(endNanos)
        if (left <= 0) break
        s.soTimeout = left
        if (input.read(buffer) < 0) break
      }
    } catch (e: SocketTimeoutException) {
      // The printer keeps its side open; the bytes were sent.
    } catch (e: IOException) {
      // A reset after the whole job was flushed is not a failed job.
    }
  }

  /** Whole milliseconds until [endNanos], rounded up, at least [MIN_WAIT_MS] while time is left; 0 once past. */
  private fun remainingMs(endNanos: Long): Int {
    val nanos = endNanos - System.nanoTime()
    if (nanos <= 0) return 0
    val ms = TimeUnit.NANOSECONDS.toMillis(nanos + TimeUnit.MILLISECONDS.toNanos(1) - 1)
    return maxOf(MIN_WAIT_MS.toLong(), ms).toInt()
  }

  /**
   * Session 3C (G5, spec §10): the printer's own answer, on the job's connection, before the job reads printed. It
   * answers once it has taken the job in. For a printer that answers DLE EOT, a connection it closed first (a slip cut
   * off mid-way), or no answer, means part of the slip may be missing: WRITE_FAILED, "maybe" (the server labels the
   * retry REPRINT). A printer that says it cannot print (out of paper, cover open, an error) has not printed it either,
   * but its link is fine. One that never answered DLE EOT prints as before: its silence or its close says nothing (G5
   * cannot see a cut there, Phase 2's limit), and one whose last idle check got no answer is asked briefly.
   */
  private fun afterJob(s: Socket, bytes: Int) {
    jobAsked = true
    jobHealth = null
    val answers = answering.contains(key)
    val wait = if (silent.contains(key)) replyMs else minOf(STATUS_AFTER_JOB_MAX_MS, afterJobMinMs + bytes / STATUS_BYTES_PER_MS)
    val first = ask(s, 1, wait)
    if (first < 0) {
      if (answers) throw TransportException(BridgeCodes.WRITE_FAILED, if (first == CLOSED) "The printer closed the link before it answered" else "The printer did not answer after the slip")
      return
    }
    answering.add(key)
    silent.remove(key)
    val health = DleEot.healthOf(answersAfter(s, first))
    jobHealth = health
    if (health?.cannotPrint() == true) throw TransportException(BridgeCodes.WRITE_FAILED, "The printer cannot print now", linkKept = true)
  }

  /** DLE EOT 2, 3 and 4 after [first] answered DLE EOT 1 (one the printer does not answer is left out). */
  private fun answersAfter(s: Socket, first: Int): Map<Int, Int> {
    val answers = HashMap<Int, Int>()
    answers[1] = first
    for (n in DleEot.QUERIES) {
      if (n == 1) continue
      val b = ask(s, n, minOf(replyMs, STATUS_FOLLOW_UP_MS))
      if (b == CLOSED) break
      if (b != NO_ANSWER) answers[n] = b
    }
    return answers
  }

  /**
   * Session 3C (spec §10; the 3A review gate's m-B): right after a job, what that job's own connection read (no second
   * connection); otherwise one connect, DLE EOT, close, which is also the idle check of the link: a printer switched off
   * between jobs throws NOT_CONNECTED here within a minute, not at the next slip.
   */
  override fun status(): PrinterHealth? {
    if (jobAsked) {
      jobAsked = false
      return jobHealth
    }
    val s = connect()
    try {
      val first = ask(s, 1, replyMs)
      if (first < 0) {
        answering.remove(key)
        silent.add(key)
        return null
      }
      answering.add(key)
      silent.remove(key)
      val answers = answersAfter(s, first)
      s.shutdownOutput()
      return DleEot.healthOf(answers)
    } catch (e: IOException) {
      return null
    } finally {
      closeSocket(s)
    }
  }

  /** Sends DLE EOT [n] and reads until a status byte arrives (any other byte is skipped), [waitMs] in all: the byte,
   *  NO_ANSWER, or CLOSED (the printer closed or reset the connection). */
  private fun ask(s: Socket, n: Int, waitMs: Int): Int {
    try {
      val out = s.getOutputStream()
      out.write(DleEot.request(n))
      out.flush()
    } catch (e: IOException) {
      return CLOSED
    }
    val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(waitMs.toLong())
    return try {
      val input = s.getInputStream()
      var answer = NO_ANSWER
      while (answer == NO_ANSWER) {
        val left = remainingMs(endNanos)
        if (left <= 0) break
        s.soTimeout = left
        val b = input.read()
        if (b < 0) {
          answer = CLOSED
        } else if (DleEot.isAnswer(b)) {
          answer = b
        }
      }
      answer
    } catch (e: SocketTimeoutException) {
      NO_ANSWER
    } catch (e: IOException) {
      CLOSED
    }
  }

  /**
   * A fresh connection to a checked private address, trying each of the host's private addresses
   * in order (IPv4 first). All attempts share one [CONNECT_TIMEOUT_MS] budget, split evenly over the
   * addresses still to try, so a dead first address cannot use up the time the next one needs. The 3C review gate (its
   * review's I-1): an address that refused the connect is asked once more [CONNECT_REFUSED_RETRY_MS] later.
   */
  private fun connect(): Socket {
    if (closing.get()) throw closed()
    val addresses = TcpAddress.resolveAll(host)
    val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(CONNECT_TIMEOUT_MS.toLong())
    var failure = TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect")
    for ((index, address) in addresses.withIndex()) {
      var refusedBefore = false
      while (true) {
        val left = remainingMs(endNanos)
        if (left <= 0) break
        try {
          return connectTo(address, maxOf(MIN_WAIT_MS, left / (addresses.size - index)))
        } catch (e: TransportException) {
          // Only "no answer" moves on to the next address; a closed link or a bad setup is final.
          if (e.code != BridgeCodes.NOT_CONNECTED || closing.get()) throw e
          failure = e
          if (e.message != REFUSED || refusedBefore || remainingMs(endNanos) <= CONNECT_REFUSED_RETRY_MS) break
          refusedBefore = true
          try {
            Thread.sleep(CONNECT_REFUSED_RETRY_MS.toLong())
          } catch (e: InterruptedException) {
            // The 3D gold's review (m-3): never an uncaught exception on the printer's io thread.
            Thread.currentThread().interrupt()
            throw TransportException(BridgeCodes.NOT_CONNECTED, "Interrupted")
          }
        }
      }
    }
    throw failure
  }

  private fun connectTo(address: InetAddress, timeoutMs: Int): Socket {
    val s = Socket()
    active = s
    // close() sets the flag before reading [active]; this re-check closes the other order.
    if (closing.get()) {
      closeSocket(s)
      throw closed()
    }
    try {
      s.tcpNoDelay = true
      s.connect(InetSocketAddress(address, port), timeoutMs)
      return s
    } catch (e: ConnectException) {
      closeSocket(s)
      throw TransportException(BridgeCodes.NOT_CONNECTED, REFUSED)
    } catch (e: IOException) {
      closeSocket(s)
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect")
    } catch (e: IllegalArgumentException) {
      closeSocket(s)
      throw TransportException(BridgeCodes.BAD_REQUEST, "Bad address")
    } catch (e: SecurityException) {
      closeSocket(s)
      throw TransportException(BridgeCodes.UNSUPPORTED, "Network not allowed")
    }
  }

  private fun closed() = TransportException(BridgeCodes.NOT_CONNECTED, "Closed")

  private fun closeSocket(s: Socket) {
    if (active === s) active = null
    try {
      s.close()
    } catch (e: IOException) {
      // Already closed.
    }
  }

  override fun close() {
    closing.set(true)
    active?.let { closeSocket(it) }
  }
}
