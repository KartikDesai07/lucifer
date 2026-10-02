package com.possoftware.pos.printer

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.util.concurrent.atomic.AtomicBoolean

/** One bounded Classic + BLE scan. Stops itself after [PRINTER_SCAN_MS] and reports merged results. */
class ScanSession(
    private val ctx: Context,
    private val adapter: BluetoothAdapter,
    private val onDone: (List<PrinterInfo>) -> Unit,
) {
  companion object {
    /** Pinned to PRINTER_SCAN_MS in apps/mobile/src/bridge/protocol.ts. */
    const val PRINTER_SCAN_MS = 8_000L
  }

  private val main = Handler(Looper.getMainLooper())
  private val found = LinkedHashMap<String, PrinterDiscovery.Entry>()
  private val finished = AtomicBoolean(false)
  private var classicReceiver: BroadcastReceiver? = null
  private var bleCallback: ScanCallback? = null

  fun start() {
    val classic = startClassic()
    val ble = startBle()
    if (!classic && !ble) {
      finish()
      return
    }
    main.postDelayed(Runnable { finish() }, PRINTER_SCAN_MS)
  }

  private fun add(entry: PrinterDiscovery.Entry) {
    synchronized(found) {
      if (found.size < PrinterDiscovery.MAX_SCAN_RESULTS && !found.containsKey(entry.info.id)) {
        found[entry.info.id] = entry
      }
    }
  }

  private fun startClassic(): Boolean =
      try {
        val receiver =
            object : BroadcastReceiver() {
              override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != BluetoothDevice.ACTION_FOUND) return
                val device =
                    IntentCompat.getParcelableExtra(
                        intent,
                        BluetoothDevice.EXTRA_DEVICE,
                        BluetoothDevice::class.java,
                    ) ?: return
                try {
                  val hint = intent.getStringExtra(BluetoothDevice.EXTRA_NAME)
                  add(PrinterDiscovery.entryOf(ctx, device, null, hint, false, false))
                } catch (e: SecurityException) {
                  // Permission revoked mid-scan: skip this result.
                }
              }
            }
        ContextCompat.registerReceiver(
            ctx,
            receiver,
            IntentFilter(BluetoothDevice.ACTION_FOUND),
            // ACTION_FOUND is a protected broadcast sent by the Bluetooth app, so the receiver must be exported.
            ContextCompat.RECEIVER_EXPORTED,
        )
        classicReceiver = receiver
        if (adapter.isDiscovering) adapter.cancelDiscovery()
        adapter.startDiscovery()
      } catch (e: SecurityException) {
        false
      }

  private fun startBle(): Boolean =
      try {
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
          false
        } else {
          val callback =
              object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                  recordBle(result)
                }
              }
          val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
          scanner.startScan(null, settings, callback)
          bleCallback = callback
          true
        }
      } catch (e: SecurityException) {
        false
      } catch (e: IllegalStateException) {
        false
      }

  /** Keeps results that carry a name or a known printer service; the rest is radio noise. */
  private fun recordBle(result: ScanResult) {
    try {
      val record = result.scanRecord
      val knownService =
          record?.serviceUuids?.any { BlePrinterServices.isKnownService(it.uuid) } == true
      val name = record?.deviceName ?: result.device.name
      if (!knownService && name.isNullOrBlank()) return
      add(PrinterDiscovery.entryOf(ctx, result.device, null, name, true, knownService))
    } catch (e: SecurityException) {
      // Permission revoked mid-scan: skip this result.
    }
  }

  private fun finish() {
    if (!finished.compareAndSet(false, true)) return
    try {
      classicReceiver?.let { ctx.unregisterReceiver(it) }
    } catch (e: IllegalArgumentException) {
      // Already unregistered.
    }
    try {
      adapter.cancelDiscovery()
      bleCallback?.let { adapter.bluetoothLeScanner?.stopScan(it) }
    } catch (e: SecurityException) {
      // Permission revoked: the stack stops the scan itself.
    } catch (e: IllegalStateException) {
      // Bluetooth turned off mid-scan.
    }
    val merged = LinkedHashMap<String, PrinterDiscovery.Entry>()
    for (entry in PrinterDiscovery.bonded(ctx)) merged[entry.info.id] = entry
    synchronized(found) {
      for ((id, entry) in found) if (!merged.containsKey(id)) merged[id] = entry
    }
    for (entry in PrinterDiscovery.usb(ctx)) merged[entry.info.id] = entry
    onDone(PrinterDiscovery.ordered(merged.values.toList()))
  }
}
