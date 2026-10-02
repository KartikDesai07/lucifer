package com.possoftware.pos.printer

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bluetooth Classic RFCOMM (SPP) link: secure first, insecure retry, paced chunked writes. */
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
  }

  private val closing = AtomicBoolean(false)
  @Volatile private var socket: BluetoothSocket? = null
  @Volatile private var out: OutputStream? = null

  override fun open() {
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

  /** Discards inbound bytes; an end-of-stream or error without close() means the printer dropped. */
  private fun startReader(s: BluetoothSocket) {
    val input = s.inputStream
    startDaemon("pos-printer-rx") {
      val buffer = ByteArray(RX_BUFFER_BYTES)
      try {
        while (input.read(buffer) >= 0) {
          // Printer status bytes are not used.
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
