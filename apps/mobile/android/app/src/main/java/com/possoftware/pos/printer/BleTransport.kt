package com.possoftware.pos.printer

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.os.SystemClock
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * BLE GATT link. One GATT operation at a time: callbacks (binder threads) drop a single event into
 * a one-slot queue and the io thread waits for the kind it expects.
 */
class BleTransport(
    private val ctx: Context,
    private val address: String,
    private val listener: LinkListener,
) : PrinterTransport {

  companion object {
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val OP_TIMEOUT_MS = 5_000L
    const val DISCOVERY_TIMEOUT_MS = 10_000L
    const val WRITE_TIMEOUT_MS = 2_000L
    const val REQUEST_MTU = 247
    const val DEFAULT_MTU = 23
    const val ATT_HEADER_BYTES = 3
    const val MIN_CHUNK_BYTES = 20
    const val CHUNK_PAUSE_MS = 20L
    const val BUSY_RETRIES = 3
    const val BUSY_RETRY_PAUSE_MS = 30L

    private const val KIND_CONNECTED = 1
    private const val KIND_DISCONNECTED = 2
    private const val KIND_MTU = 3
    private const val KIND_SERVICES = 4
    private const val KIND_WRITE = 5
  }

  private class GattEvent(val kind: Int, val status: Int, val value: Int)

  private val events = ArrayBlockingQueue<GattEvent>(1)
  private val closing = AtomicBoolean(false)
  @Volatile private var gatt: BluetoothGatt? = null
  @Volatile private var established = false
  @Volatile private var lost = false
  @Volatile private var characteristic: BluetoothGattCharacteristic? = null
  @Volatile private var mtu = DEFAULT_MTU
  private var writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT

  private val callback =
      object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
          if (newState == BluetoothProfile.STATE_CONNECTED) {
            post(KIND_CONNECTED, status, 0)
          } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            lost = true
            post(KIND_DISCONNECTED, status, 0)
            if (established && !closing.get()) listener.onLinkLost(this@BleTransport)
          }
        }

        override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) {
          post(KIND_MTU, status, newMtu)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
          post(KIND_SERVICES, status, 0)
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            ch: BluetoothGattCharacteristic,
            status: Int,
        ) {
          post(KIND_WRITE, status, 0)
        }
      }

  /** The newest event replaces any stale one, so a waiter never reads an old answer. */
  private fun post(kind: Int, status: Int, value: Int) {
    synchronized(events) {
      events.clear()
      events.offer(GattEvent(kind, status, value))
    }
  }

  /** Waits for [kind]; null on timeout; throws when the link is gone or closing. */
  private fun await(kind: Int, timeoutMs: Long): GattEvent? {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (true) {
      if (lost || closing.get()) throw TransportException(BridgeCodes.NOT_CONNECTED, "Link lost")
      val remaining = deadline - SystemClock.elapsedRealtime()
      if (remaining <= 0) return null
      val event =
          try {
            events.poll(remaining, TimeUnit.MILLISECONDS)
          } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw TransportException(BridgeCodes.NOT_CONNECTED, "Interrupted")
          }
      if (event != null && event.kind == kind) return event
    }
  }

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
      events.clear()
      val g =
          device.connectGatt(ctx, false, callback, BluetoothDevice.TRANSPORT_LE)
              ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not start GATT")
      gatt = g
      val connected = await(KIND_CONNECTED, CONNECT_TIMEOUT_MS)
      if (connected == null || connected.status != BluetoothGatt.GATT_SUCCESS) {
        throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect")
      }
      mtu = negotiateMtu(g)
      discover(g)
      // Long slips are many acknowledged writes; the fast interval keeps them inside the job watchdog.
      g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
      established = true
    } catch (e: SecurityException) {
      close()
      throw TransportException(BridgeCodes.UNAUTHORIZED, "Bluetooth permission missing")
    } catch (e: TransportException) {
      close()
      throw e
    }
  }

  private fun negotiateMtu(g: BluetoothGatt): Int {
    events.clear()
    if (!g.requestMtu(REQUEST_MTU)) return DEFAULT_MTU
    val event = await(KIND_MTU, OP_TIMEOUT_MS) ?: return DEFAULT_MTU
    return if (event.status == BluetoothGatt.GATT_SUCCESS && event.value >= DEFAULT_MTU) {
      event.value
    } else {
      DEFAULT_MTU
    }
  }

  private fun discover(g: BluetoothGatt) {
    events.clear()
    if (!g.discoverServices()) {
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Service discovery failed")
    }
    val event = await(KIND_SERVICES, DISCOVERY_TIMEOUT_MS)
    if (event == null || event.status != BluetoothGatt.GATT_SUCCESS) {
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Service discovery failed")
    }
    val ch =
        BlePrinterServices.pick(g.services)
            ?: throw TransportException(BridgeCodes.UNSUPPORTED, "No writable characteristic")
    characteristic = ch
    writeType =
        if (BlePrinterServices.hasAcknowledgedWrite(ch)) {
          BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        } else {
          BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        }
  }

  override fun write(data: ByteArray) {
    val g = gatt
    val ch = characteristic
    if (g == null || ch == null || !established) {
      throw TransportException(BridgeCodes.NOT_CONNECTED, "Not connected")
    }
    val chunk = maxOf(MIN_CHUNK_BYTES, mtu - ATT_HEADER_BYTES)
    var offset = 0
    while (offset < data.size) {
      val end = minOf(offset + chunk, data.size)
      writeChunk(g, ch, data.copyOfRange(offset, end))
      offset = end
      if (writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE && offset < data.size) {
        pauseMs(CHUNK_PAUSE_MS)
      }
    }
  }

  private fun writeChunk(g: BluetoothGatt, ch: BluetoothGattCharacteristic, bytes: ByteArray) {
    var retries = 0
    while (true) {
      events.clear()
      if (issueWrite(g, ch, bytes)) break
      if (retries++ >= BUSY_RETRIES) {
        throw TransportException(BridgeCodes.WRITE_FAILED, "GATT busy")
      }
      pauseMs(BUSY_RETRY_PAUSE_MS)
    }
    val event =
        await(KIND_WRITE, WRITE_TIMEOUT_MS)
            ?: throw TransportException(BridgeCodes.TIMEOUT, "Write timed out")
    if (event.status != BluetoothGatt.GATT_SUCCESS) {
      throw TransportException(BridgeCodes.WRITE_FAILED, "Write failed")
    }
  }

  /** API 33+ takes the value as an argument; earlier releases set it on the characteristic. */
  private fun issueWrite(
      g: BluetoothGatt,
      ch: BluetoothGattCharacteristic,
      bytes: ByteArray,
  ): Boolean =
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          g.writeCharacteristic(ch, bytes, writeType) == BluetoothStatusCodes.SUCCESS
        } else {
          legacyWrite(g, ch, bytes)
        }
      } catch (e: SecurityException) {
        throw TransportException(BridgeCodes.UNAUTHORIZED, "Bluetooth permission missing")
      }

  @Suppress("DEPRECATION")
  private fun legacyWrite(
      g: BluetoothGatt,
      ch: BluetoothGattCharacteristic,
      bytes: ByteArray,
  ): Boolean {
    ch.writeType = writeType
    ch.value = bytes
    return g.writeCharacteristic(ch)
  }

  override fun close() {
    closing.set(true)
    val g = gatt
    gatt = null
    try {
      g?.disconnect()
      g?.close()
    } catch (e: SecurityException) {
      // Permission revoked: the stack tears the link down itself.
    }
    post(KIND_DISCONNECTED, BluetoothGatt.GATT_SUCCESS, 0)
  }
}
