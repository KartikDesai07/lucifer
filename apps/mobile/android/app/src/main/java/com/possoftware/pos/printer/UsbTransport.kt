package com.possoftware.pos.printer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** USB printer-class link: bulk OUT transfers. The permission prompt only ever shows while visible. */
class UsbTransport(
    private val ctx: Context,
    private val vendorId: Int,
    private val productId: Int,
    private val isVisible: () -> Boolean,
) : PrinterTransport {

  companion object {
    const val ACTION_USB_PERMISSION = "com.possoftware.pos.USB_PERMISSION"
    const val REQ_USB = 4103
    const val PERMISSION_TIMEOUT_MS = 60_000L
    const val TRANSFER_TIMEOUT_MS = 5_000
    const val CHUNK_BYTES = 4_096

    /** The printer-class interface and its bulk OUT endpoint, or null when the device has none. */
    fun findBulkOut(device: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
      for (i in 0 until device.interfaceCount) {
        val intf = device.getInterface(i)
        if (intf.interfaceClass != UsbConstants.USB_CLASS_PRINTER) continue
        for (j in 0 until intf.endpointCount) {
          val ep = intf.getEndpoint(j)
          if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
              ep.direction == UsbConstants.USB_DIR_OUT) {
            return Pair(intf, ep)
          }
        }
      }
      return null
    }
  }

  @Volatile private var connection: UsbDeviceConnection? = null
  @Volatile private var claimed: UsbInterface? = null
  @Volatile private var endpoint: UsbEndpoint? = null
  private val lifecycleLock = Any()
  @Volatile private var closed = false
  @Volatile private var permissionAnswer: CountDownLatch? = null

  fun matches(vendor: Int, product: Int): Boolean = vendor == vendorId && product == productId

  override fun open() {
    ensureOpen()
    val usb =
        ctx.getSystemService(Context.USB_SERVICE) as? UsbManager
            ?: throw TransportException(BridgeCodes.UNSUPPORTED, "No USB host")
    val matches = usb.deviceList.values.filter { it.vendorId == vendorId && it.productId == productId }
    // VID/PID identify a model, not a physical printer. Never silently send a
    // kitchen ticket to an arbitrary device when two identical models attach.
    if (matches.size > 1) throw TransportException(BridgeCodes.UNSUPPORTED, "Attach only one printer of this model")
    val device = matches.singleOrNull()
        ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "USB printer not attached")
    val (intf, ep) =
        findBulkOut(device)
            ?: throw TransportException(BridgeCodes.UNSUPPORTED, "Not a USB printer")
    if (!usb.hasPermission(device)) {
      // Background reconnects must never raise a system dialog.
      if (!isVisible()) throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true)
      requestPermission(usb, device)
      ensureOpen()
      // Never trust the broadcast extra; ask the system again.
      if (!usb.hasPermission(device)) {
        throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission denied")
      }
    }
    val conn =
        usb.openDevice(device)
            ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not open USB printer")
    if (!conn.claimInterface(intf, true)) {
      conn.close()
      throw TransportException(BridgeCodes.NOT_CONNECTED, "USB printer is in use")
    }
    synchronized(lifecycleLock) {
      if (closed) {
        conn.releaseInterface(intf)
        conn.close()
        ensureOpen()
      }
      claimed = intf
      endpoint = ep
      connection = conn
    }
  }

  private fun ensureOpen() {
    if (closed) throw TransportException(BridgeCodes.NOT_CONNECTED, "USB connection cancelled")
  }

  private fun requestPermission(usb: UsbManager, device: UsbDevice) {
    val answered = CountDownLatch(1)
    synchronized(lifecycleLock) {
      ensureOpen()
      permissionAnswer = answered
    }
    val receiver =
        object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            val target = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            // The extra names the device; a reply without it is still a reply. hasPermission() decides below.
            if (intent.action == ACTION_USB_PERMISSION && (target == null || target.deviceName == device.deviceName)) answered.countDown()
          }
        }
    ContextCompat.registerReceiver(
        ctx,
        receiver,
        IntentFilter(ACTION_USB_PERMISSION),
        ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    try {
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val reply =
          PendingIntent.getBroadcast(
              ctx,
              REQ_USB,
              Intent(ACTION_USB_PERMISSION).setPackage(ctx.packageName),
              flags,
          )
      ensureOpen()
      usb.requestPermission(device, reply)
      answered.await(PERMISSION_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw TransportException(BridgeCodes.UNAUTHORIZED, "Interrupted")
    } finally {
      permissionAnswer = null
      try {
        ctx.unregisterReceiver(receiver)
      } catch (e: IllegalArgumentException) {
        // Never registered or already removed.
      }
    }
  }

  override fun write(data: ByteArray) {
    val conn = connection ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Not connected")
    val ep = endpoint ?: throw TransportException(BridgeCodes.NOT_CONNECTED, "Not connected")
    var offset = 0
    while (offset < data.size) {
      val count = minOf(CHUNK_BYTES, data.size - offset)
      val sent = conn.bulkTransfer(ep, data, offset, count, TRANSFER_TIMEOUT_MS)
      if (sent <= 0) throw TransportException(BridgeCodes.WRITE_FAILED, "USB write failed")
      offset += sent
    }
  }

  override fun close() {
    val (conn, intf) = synchronized(lifecycleLock) {
      closed = true
      permissionAnswer?.countDown()
      val owned = Pair(connection, claimed)
      connection = null
      claimed = null
      endpoint = null
      owned
    }
    if (conn == null) return
    try {
      intf?.let { conn.releaseInterface(it) }
    } catch (e: RuntimeException) {
      // Device already gone.
    } finally {
      try { conn.close() } catch (_: RuntimeException) { }
    }
  }
}
