package com.possoftware.pos.printer

/**
 * Wire strings of the native bridge (contract v1). Every value here is pinned to
 * apps/mobile/src/bridge/protocol.ts by a source test; change both sides together.
 */
object BridgeCodes {
  // Error codes (promise rejections).
  const val NOT_CONNECTED = "NOT_CONNECTED"
  const val WRITE_FAILED = "WRITE_FAILED"
  const val TOO_LARGE = "TOO_LARGE"
  const val BUSY = "BUSY"
  const val TIMEOUT = "TIMEOUT"
  const val UNAUTHORIZED = "UNAUTHORIZED"
  const val BLUETOOTH_OFF = "BLUETOOTH_OFF"
  const val UNSUPPORTED = "UNSUPPORTED"
  const val BAD_REQUEST = "BAD_REQUEST"
  const val LOCATION_OFF = "LOCATION_OFF"

  // Printer transports.
  const val TRANSPORT_BT_CLASSIC = "bt-classic"
  const val TRANSPORT_BLE = "ble"
  const val TRANSPORT_TCP = "tcp"
  const val TRANSPORT_USB = "usb"

  // Printer states.
  const val STATE_NONE = "none"
  const val STATE_CONNECTING = "connecting"
  const val STATE_CONNECTED = "connected"
  const val STATE_DISCONNECTED = "disconnected"

  // Bluetooth states.
  const val BT_ON = "on"
  const val BT_OFF = "off"
  const val BT_UNAUTHORIZED = "unauthorized"
  const val BT_UNSUPPORTED = "unsupported"

  // Page events built and delivered natively.
  const val EVENT_PRINTER_STATUS = "printer.status"
  const val EVENT_APP_WAKE = "app.wake"

  const val PLATFORM = "android"
  const val BRIDGE_VERSION = 1

  /** Phase 2 Session 2F2 (spec §9.2): bridge v2, beside v1 (apps/mobile/src/bridge/protocol-v2.ts; parity pinned). */
  const val BRIDGE_V2 = 2

  val TRANSPORTS: List<String> =
      listOf(TRANSPORT_BT_CLASSIC, TRANSPORT_BLE, TRANSPORT_TCP, TRANSPORT_USB)
}
