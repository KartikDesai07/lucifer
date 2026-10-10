package com.possoftware.pos.printer

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bluetooth Classic RFCOMM (SPP) link: secure first, insecure retry, paced chunked writes. Session 3C (spec §10): the
 *  printer's DLE EOT answers arrive on the link's input stream. */
class ClassicTransport(
    private val ctx: Context,
    private val address: String,
    private val listener: LinkListener,
    private val timer: ScheduledExecutorService,
) : PrinterTransport {

  companion object {
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val PAIRING_CONNECT_TIMEOUT_MS = 30_000L
    const val CHUNK_BYTES = 512
    const val CHUNK_PAUSE_MS = 10L
    const val RX_BUFFER_BYTES = 64
    /** Session 3C: one DLE EOT answer; at most this many bytes the printer sent are kept for the next status. */
    const val STATUS_REPLY_MS = 1_000L
    const val STATUS_FOLLOW_UP_MS = 300L
    const val RX_KEPT_BYTES = 256
  }

  private val closing = AtomicBoolean(false)
  @Volatile private var socket: BluetoothSocket? = null
  @Volatile private var out: OutputStream? = null
  private val received = LinkedBlockingQueue<Int>(RX_KEPT_BYTES)

  override fun open() {
    if (closing.get()) throw TransportException(BridgeCodes.NOT_CONNECTED, "Closed")
    val adapter =
        BtAccess.adapter(ctx)
            ?: throw TransportException(BridgeCodes.UNSUPPORTED, "No Bluetooth adapter")
    try {
      if (!BtAccess.hasConnect(ctx)) {
        throw TransportException(BridgeCodes.UNAUTHORIZED, "Bluetooth permission missing")
      }
      if (!adapter.isEnabled) {
        throw TransportException(BridgeCodes.BLUETOOTH_OFF, "Bluetooth is off")
      }
      val device =
          try {
            adapter.getRemoteDevice(address)
          } catch (e: IllegalArgumentException) {
            throw TransportException(BridgeCodes.BAD_REQUEST, "Bad Bluetooth address")
          }
      if (adapter.isDiscovering) adapter.cancelDiscovery()
      val bonded = device.bondState == BluetoothDevice.BOND_BONDED
      val timeoutMs = if (bonded) CONNECT_TIMEOUT_MS else PAIRING_CONNECT_TIMEOUT_MS
      val connected =
          try {
            connect(device, false, timeoutMs)
          } catch (e: IOException) {
            if (closing.get()) throw TransportException(BridgeCodes.NOT_CONNECTED, "Closed")
            connect(device, true, timeoutMs)
          }
      out = connected.outputStream
      startReader(connected)
    } catch (e: SecurityException) {
      close()
      throw TransportException(BridgeCodes.UNAUTHORIZED, "Bluetooth permission missing")
    } catch (e: IOException) {
      close()
      if (e is TransportException) throw e
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect")
    }
  }

  private fun connect(device: BluetoothDevice, insecure: Boolean, timeoutMs: Long): BluetoothSocket {
    val s =
        if (insecure) {
          device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
        } else {
          device.createRfcommSocketToServiceRecord(SPP_UUID)
        }
    socket = s
    if (closing.get()) {
      closeSocket(s)
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Closed")
    }
    val deadline = timer.schedule(Runnable { closeSocket(s) }, timeoutMs, TimeUnit.MILLISECONDS)
    try {
      s.connect()
    } catch (e: IOException) {
      closeSocket(s)
      throw e
    } finally {
      deadline.cancel(false)
    }
    return s
  }

  /** Keeps the bytes the printer sends (its DLE EOT answers; the oldest are dropped once RX_KEPT_BYTES wait); an
   *  end-of-stream or error without close() means the printer dropped. */
  private fun startReader(s: BluetoothSocket) {
    val input = s.inputStream
    startDaemon("pos-printer-rx") {
      val buffer = ByteArray(RX_BUFFER_BYTES)
      try {
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          for (i in 0 until count) received.offer(buffer[i].toInt() and 0xFF)
        }
      } catch (e: IOException) {
        // Falls through to the lost-link report below.
      }
      if (!closing.get()) listener.onLinkLost(this)
    }
  }

  override fun write(data: ByteArray) {
    val stream = out ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Not connected")
    try {
      var offset = 0
      while (offset < data.size) {
        val count = minOf(CHUNK_BYTES, data.size - offset)
        stream.write(data, offset, count)
        offset += count
        if (offset < data.size) pauseMs(CHUNK_PAUSE_MS)
      }
      stream.flush()
    } catch (e: TransportException) {
      throw e
    } catch (e: IOException) {
      throw TransportException(BridgeCodes.WRITE_FAILED, "Write failed")
    }
  }

  /** Session 3C (spec §10): DLE EOT 1 to 4, each answer read from the link; null when it does not answer DLE EOT 1. */
  override fun status(): PrinterHealth? {
    val stream = out ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Not connected")
    received.clear()
    val answers = HashMap<Int, Int>()
    for (n in DleEot.QUERIES) {
      try {
        stream.write(DleEot.request(n))
        stream.flush()
      } catch (e: IOException) {
        throw TransportException(BridgeCodes.NOT_CONNECTED, "Write failed")
      }
      val answer = awaitAnswer(if (n == 1) STATUS_REPLY_MS else STATUS_FOLLOW_UP_MS)
      if (answer == null && n == 1) return null
      if (answer != null) answers[n] = answer
    }
    return DleEot.healthOf(answers)
  }

  private fun awaitAnswer(waitMs: Long): Int? {
    val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(waitMs)
    while (true) {
      val left = endNanos - System.nanoTime()
      if (left <= 0) return null
      val b =
          try {
            received.poll(left, TimeUnit.NANOSECONDS)
          } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return null
          } ?: return null
      if (DleEot.isAnswer(b)) return b
    }
  }

  override fun close() {
    closing.set(true)
    socket?.let { closeSocket(it) }
  }

  private fun closeSocket(s: BluetoothSocket) {
    try {
      s.close()
    } catch (e: IOException) {
      // Already closed.
    }
  }
}
