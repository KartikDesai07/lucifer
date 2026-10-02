package com.possoftware.pos.printer

import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattService
import java.util.UUID

/** Known BLE printer services (vendor table) plus the generic "first writable" fallback. */
object BlePrinterServices {
  private class Known(val service: UUID, val characteristic: UUID?)

  private fun uuid16(short: String): UUID = UUID.fromString("0000$short-0000-1000-8000-00805f9b34fb")

  private val KNOWN =
      listOf(
          Known(uuid16("18f0"), uuid16("2af1")),
          Known(
              UUID.fromString("49535343-fe7d-4ae5-8fa9-9fafd205e455"),
              UUID.fromString("49535343-8841-43f4-a8d4-ecbe34729bb3"),
          ),
          Known(uuid16("ff00"), uuid16("ff02")),
          Known(UUID.fromString("e7810a71-73ae-499d-8c15-faa9aef0c3f2"), null),
          Known(uuid16("ae30"), uuid16("ae01")),
      )

  /** Generic access / attribute / device-information services never carry print data. */
  private val SKIPPED = setOf(uuid16("1800"), uuid16("1801"), uuid16("180a"))

  private const val WRITABLE_MASK =
      BluetoothGattCharacteristic.PROPERTY_WRITE or
          BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE

  fun isKnownService(uuid: UUID): Boolean = KNOWN.any { it.service == uuid }

  fun isWritable(ch: BluetoothGattCharacteristic): Boolean = (ch.properties and WRITABLE_MASK) != 0

  /** True when the characteristic supports a write that is acknowledged (preferred write type). */
  fun hasAcknowledgedWrite(ch: BluetoothGattCharacteristic): Boolean =
      (ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0

  /** The table first, then the first writable characteristic outside the generic services. */
  fun pick(services: List<BluetoothGattService>): BluetoothGattCharacteristic? {
    for (known in KNOWN) {
      val service = services.firstOrNull { it.uuid == known.service } ?: continue
      val wanted = known.characteristic
      val ch =
          if (wanted != null) {
            service.getCharacteristic(wanted)?.takeIf { isWritable(it) }
          } else {
            service.characteristics.firstOrNull { isWritable(it) }
          }
      if (ch != null) return ch
    }
    for (service in services) {
      if (SKIPPED.contains(service.uuid)) continue
      val ch = service.characteristics.firstOrNull { isWritable(it) }
      if (ch != null) return ch
    }
    return null
  }
}
