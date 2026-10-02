package com.possoftware.pos.printer

import android.content.Context
import java.util.concurrent.ScheduledExecutorService

/** Builds the transport for a printer id; throws [TransportException] BAD_REQUEST for a bad id. */
object TransportFactory {
  private fun bad(): TransportException =
      TransportException(BridgeCodes.BAD_REQUEST, "Unknown printer")

  fun create(
      ctx: Context,
      info: PrinterInfo,
      listener: LinkListener,
      timer: ScheduledExecutorService,
      isVisible: () -> Boolean,
  ): PrinterTransport =
      when (info.transport) {
        BridgeCodes.TRANSPORT_BT_CLASSIC ->
            ClassicTransport(ctx, PrinterIds.macOf(info.id) ?: throw bad(), listener, timer)
        BridgeCodes.TRANSPORT_BLE ->
            BleTransport(ctx, PrinterIds.macOf(info.id) ?: throw bad(), listener)
        BridgeCodes.TRANSPORT_TCP -> {
          val target = PrinterIds.tcpOf(info.id) ?: throw bad()
          TcpTransport(target.first, target.second)
        }
        BridgeCodes.TRANSPORT_USB -> {
          val ids = PrinterIds.usbOf(info.id) ?: throw bad()
          UsbTransport(ctx, ids.first, ids.second, isVisible)
        }
        else -> throw bad()
      }
}
