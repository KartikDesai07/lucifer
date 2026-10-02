package com.possoftware.pos.printer

import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat

/** Process-lifetime system broadcasts: Bluetooth on/off and USB attach/detach. */
object PrinterReceivers {
  fun register(app: Context) {
    val receiver =
        object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
              UsbManager.ACTION_USB_DEVICE_ATTACHED -> PrinterApi.onUsbAttached()
              UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                val device =
                    IntentCompat.getParcelableExtra(
                        intent,
                        UsbManager.EXTRA_DEVICE,
                        UsbDevice::class.java,
                    )
                if (device != null) PrinterApi.onUsbDetached(device.vendorId, device.productId)
              }
            }
          }
        }
    val filter = IntentFilter()
    filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
    filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
    ContextCompat.registerReceiver(app, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    // Bluetooth broadcasts may come from the privileged Bluetooth process,
    // not the system UID. NOT_EXPORTED drops these on some Android versions.
    // The handler re-reads adapter state; it never trusts broadcast extras.
    val bluetoothReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) PrinterApi.onBluetoothStateChanged()
      }
    }
    ContextCompat.registerReceiver(app, bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
  }
}
