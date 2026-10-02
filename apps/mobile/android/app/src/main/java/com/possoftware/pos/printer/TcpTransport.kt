package com.possoftware.pos.printer

import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Raw TCP link to a network printer (normally port 9100). There is no standing connection: every
 * job connects, writes, half-closes and closes, so a printer that was switched off or lost its
 * address can never swallow a slip. [open] is only a connect probe that makes the status honest.
 */
class TcpTransport(
    private val host: String,
    private val port: Int,
) : PrinterTransport {

  companion object {
    const val CONNECT_TIMEOUT_MS = 5_000
    const val DRAIN_TIMEOUT_MS = 750
    const val CHUNK_BYTES = 4_096
    const val RX_BUFFER_BYTES = 64

    /** A socket timeout of 0 means "wait forever", so no wait is ever shorter than this. */
    const val MIN_WAIT_MS = 1
  }

  private val closing = AtomicBoolean(false)
  @Volatile private var active: Socket? = null

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
      s.shutdownOutput()
      drain(s)
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
   * A fresh connection to a checked private address, trying each of the host's private addresses
   * in order (IPv4 first). All attempts share one [CONNECT_TIMEOUT_MS] budget, split evenly over the
   * addresses still to try, so a dead first address cannot use up the time the next one needs.
   */
  private fun connect(): Socket {
    if (closing.get()) throw closed()
    val addresses = TcpAddress.resolveAll(host)
    val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(CONNECT_TIMEOUT_MS.toLong())
    var failure = TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect")
    for ((index, address) in addresses.withIndex()) {
      val left = remainingMs(endNanos)
      if (left <= 0) break
      try {
        return connectTo(address, maxOf(MIN_WAIT_MS, left / (addresses.size - index)))
      } catch (e: TransportException) {
        // Only "no answer" moves on to the next address; a closed link or a bad setup is final.
        if (e.code != BridgeCodes.NOT_CONNECTED || closing.get()) throw e
        failure = e
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
