package com.possoftware.pos.printer

import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.hardware.usb.UsbManager
import com.possoftware.pos.R
import java.util.concurrent.atomic.AtomicBoolean

/** Plain-English fallback names for printers that report none. */
object PrinterNames {
  private const val MAC_TAIL_CHARS = 5

  fun bluetooth(ctx: Context, deviceName: String?, address: String): String =
      if (!deviceName.isNullOrBlank()) {
        deviceName
      } else {
        ctx.getString(R.string.printer_name_bluetooth, address.takeLast(MAC_TAIL_CHARS))
      }

  fun usb(ctx: Context, productName: String?): String =
      if (!productName.isNullOrBlank()) productName else ctx.getString(R.string.printer_name_usb)

  fun network(ctx: Context, host: String): String = ctx.getString(R.string.printer_name_network, host)
}

/** Paired devices, attached USB printers and the bounded Bluetooth scan. */
object PrinterDiscovery {
  const val MAX_SCAN_RESULTS = 50

  /** A listed printer plus whether it looks like a printer (sorted first). */
  class Entry(val info: PrinterInfo, val printerLike: Boolean)

  private val scanning = AtomicBoolean(false)

  /** Paired + USB, without scanning. */
  fun known(ctx: Context): List<PrinterInfo> = ordered(bonded(ctx) + usb(ctx))

  fun ordered(entries: List<Entry>): List<PrinterInfo> =
      entries.sortedBy { !it.printerLike }.map { it.info }

  /** One Bluetooth device as a list entry. [forceBle] is set for LE scan results. */
  fun entryOf(
      ctx: Context,
      device: BluetoothDevice,
      paired: Boolean?,
      nameHint: String?,
      forceBle: Boolean,
      likeHint: Boolean,
  ): Entry {
    val address = device.address
    val ble = forceBle || device.type == BluetoothDevice.DEVICE_TYPE_LE
    val id = if (ble) PrinterIds.ble(address) else PrinterIds.classic(address)
    val transport = if (ble) BridgeCodes.TRANSPORT_BLE else BridgeCodes.TRANSPORT_BT_CLASSIC
    val name = PrinterNames.bluetooth(ctx, nameHint ?: device.name, address)
    val imaging = device.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING
    return Entry(PrinterInfo(id, name, transport, address, paired), imaging || likeHint)
  }

  fun bonded(ctx: Context): List<Entry> {
    val adapter = BtAccess.adapter(ctx) ?: return emptyList()
    if (!BtAccess.hasConnect(ctx)) return emptyList()
    return try {
      val devices = adapter.bondedDevices ?: return emptyList()
      devices.map { entryOf(ctx, it, true, null, false, false) }
    } catch (e: SecurityException) {
      emptyList()
    }
  }

  fun usb(ctx: Context): List<Entry> {
    val manager = ctx.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
    val entries = ArrayList<Entry>()
    for (device in manager.deviceList.values) {
      if (UsbTransport.findBulkOut(device) == null) continue
      val id = PrinterIds.usb(device.vendorId, device.productId)
      if (entries.any { it.info.id == id }) continue
      val name = PrinterNames.usb(ctx, device.productName)
      entries.add(Entry(PrinterInfo(id, name, BridgeCodes.TRANSPORT_USB), true))
    }
    return entries
  }

  /** A printer info for an id the page selects without having listed it first. */
  fun infoFromId(ctx: Context, id: String): PrinterInfo? {
    val transport = PrinterIds.transportOf(id) ?: return null
    return when (transport) {
      BridgeCodes.TRANSPORT_BT_CLASSIC,
      BridgeCodes.TRANSPORT_BLE -> {
        val mac = PrinterIds.macOf(id) ?: return null
        val canonical = if (transport == BridgeCodes.TRANSPORT_BLE) PrinterIds.ble(mac) else PrinterIds.classic(mac)
        PrinterInfo(canonical, PrinterNames.bluetooth(ctx, null, mac), transport, mac)
      }
      BridgeCodes.TRANSPORT_USB -> {
        val ids = PrinterIds.usbOf(id) ?: return null
        PrinterInfo(PrinterIds.usb(ids.first, ids.second), PrinterNames.usb(ctx, null), transport)
      }
      else -> {
        val target = PrinterIds.tcpOf(id) ?: return null
        tcpInfo(ctx, target.first, target.second)
      }
    }
  }

  fun tcpInfo(ctx: Context, host: String, port: Int): PrinterInfo =
      PrinterInfo(
          PrinterIds.tcp(host, port),
          PrinterNames.network(ctx, host),
          BridgeCodes.TRANSPORT_TCP,
          host + ":" + port,
      )

  /** Starts a bounded scan; false when one is already running. [onDone] runs once, on the main thread. */
  fun scan(ctx: Context, onDone: (List<PrinterInfo>) -> Unit): Boolean {
    val adapter = BtAccess.adapter(ctx)
    if (!scanning.compareAndSet(false, true)) return false
    if (adapter == null) {
      scanning.set(false)
      onDone(known(ctx))
      return true
    }
    ScanSession(ctx, adapter) { list ->
      scanning.set(false)
      onDone(list)
    }.start()
    return true
  }
}
