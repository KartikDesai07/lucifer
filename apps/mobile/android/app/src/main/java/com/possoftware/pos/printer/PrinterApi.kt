package com.possoftware.pos.printer

import android.content.Context

/**
 * Request entry points for the module and the system receivers. Every call returns at once and does its work on the
 * timer thread (never blocks) or a printer's own io thread (connect, write).
 *
 * Phase 2 Session 2F2 (spec §9.2, bridge v2): a v1 call acts on the app's default printer exactly as v1 always acted on
 * its one printer (a v1 select replaces it, a v1 forget removes it); a v2 call names its printer by the app's id and
 * answers with every printer ([PrinterPool.poolStatus]); a v2 select adds a printer to the list.
 */
object PrinterApi {
  /** The selection slot of v1 calls (the default printer); a v2 call's slot is its printer's id. */
  private const val V1_SLOT = ""

  private val timer = PrinterThreads.timer

  fun listPrinters(scan: Boolean, cb: ReplyCallback<List<PrinterInfo>>) {
    timer.execute(
        Runnable {
          val ctx = PrinterPool.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
          } else if (!scan) {
            cb(Reply.Ok(PrinterPool.remember(PrinterDiscovery.known(ctx))))
          } else if (!BtAccess.hasScan(ctx) || !BtAccess.hasConnect(ctx)) {
            cb(Reply.fail(BridgeCodes.UNAUTHORIZED))
          } else if (BtAccess.locationOff(ctx)) {
            cb(Reply.fail(BridgeCodes.LOCATION_OFF))
          } else {
            val started =
                PrinterDiscovery.scan(ctx) { list ->
                  timer.execute(Runnable { cb(Reply.Ok(PrinterPool.remember(list))) })
                }
            if (!started) cb(Reply.fail(BridgeCodes.BUSY))
          }
        }
    )
  }

  fun selectPrinter(id: String, cb: ReplyCallback<StatusSnapshot>) = selectById(id, false, cb) { PrinterPool.status() }

  fun selectTcp(host: String, port: Int, cb: ReplyCallback<StatusSnapshot>) = selectByTcp(host, port, false, cb) { PrinterPool.status() }

  fun poolSelectPrinter(id: String, cb: ReplyCallback<PoolSnapshot>) = selectById(id, true, cb) { PrinterPool.poolStatus() }

  fun poolSelectTcp(host: String, port: Int, cb: ReplyCallback<PoolSnapshot>) = selectByTcp(host, port, true, cb) { PrinterPool.poolStatus() }

  private fun <T> selectById(id: String, v2: Boolean, cb: ReplyCallback<T>, answer: () -> T) {
    timer.execute(
        Runnable {
          val ctx = PrinterPool.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
            return@Runnable
          }
          val info = PrinterPool.lookup(id) ?: PrinterDiscovery.infoFromId(ctx, id)
          if (info == null) cb(Reply.fail(BridgeCodes.BAD_REQUEST)) else select(ctx, info, v2, cb, answer)
        }
    )
  }

  private fun <T> selectByTcp(host: String, port: Int, v2: Boolean, cb: ReplyCallback<T>, answer: () -> T) {
    timer.execute(
        Runnable {
          val ctx = PrinterPool.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
          } else if (!PrinterIds.validHost(host) || !PrinterIds.validPort(port)) {
            cb(Reply.fail(BridgeCodes.BAD_REQUEST))
          } else {
            select(ctx, PrinterDiscovery.tcpInfo(ctx, host, port), v2, cb, answer)
          }
        }
    )
  }

  /** Saves the choice, then settles after the first attempt (connected or disconnected). */
  private fun <T> select(ctx: Context, info: PrinterInfo, v2: Boolean, cb: ReplyCallback<T>, answer: () -> T) {
    // A newer selection for the same slot aborts the lookup of an older one before anything else happens.
    val slot = if (v2) info.id else V1_SLOT
    val ticket = SelectionFence.begin(slot)
    if (PrinterManager.isBluetooth(info)) {
      val failure =
          when (BtAccess.state(ctx)) {
            BridgeCodes.BT_UNSUPPORTED -> BridgeCodes.UNSUPPORTED
            BridgeCodes.BT_UNAUTHORIZED -> BridgeCodes.UNAUTHORIZED
            BridgeCodes.BT_OFF -> BridgeCodes.BLUETOOTH_OFF
            else -> null
          }
      if (failure != null) {
        cb(Reply.fail(failure))
        return
      }
    }
    if (info.transport == BridgeCodes.TRANSPORT_TCP) {
      fenceThenCommit(info, slot, ticket, cb, answer) { commit(info, v2, cb, answer) }
    } else {
      commit(info, v2, cb, answer)
    }
  }

  /**
   * Checks a network host on the dns thread (DNS blocks; never an io thread). A non-private address is BAD_REQUEST,
   * and a selection made newer for the same slot meanwhile is not committed.
   */
  private fun <T> fenceThenCommit(info: PrinterInfo, slot: String, ticket: Int, cb: ReplyCallback<T>, answer: () -> T, commit: () -> Unit) {
    val target = PrinterIds.tcpOf(info.id)
    if (target == null) {
      cb(Reply.fail(BridgeCodes.BAD_REQUEST))
      return
    }
    SelectionFence.check(target.first, slot, ticket, cb, answer, commit)
  }

  private fun <T> commit(info: PrinterInfo, v2: Boolean, cb: ReplyCallback<T>, answer: () -> T) {
    if (v2) {
      val manager = PrinterPool.add(info)
      manager.connectAsync(manager.begin()) { cb(Reply.Ok(answer())) }
      return
    }
    // Session 3C (the 2G review's m-3): a printer already listed keeps its link and only becomes the default; it answers
    // once its own attempt in flight settled (one connect, never two). Only a new one, or one that is down, connects now.
    val selected = PrinterPool.replaceDefault(info)
    val manager = selected.manager
    if (selected.fresh || manager.state() == BridgeCodes.STATE_DISCONNECTED) {
      manager.connectAsync(manager.begin()) { cb(Reply.Ok(answer())) }
    } else if (manager.state() == BridgeCodes.STATE_CONNECTING) {
      manager.afterIo { cb(Reply.Ok(answer())) }
    } else {
      // The 3C review gate (its review's m-3): a connected one answers at once, never behind a slip it is printing.
      cb(Reply.Ok(answer()))
    }
  }

  fun reconnect(cb: ReplyCallback<StatusSnapshot>) =
      timer.execute(Runnable { reconnectOf(PrinterPool.defaultManager(), cb) { PrinterPool.status() } })

  fun poolReconnect(printerId: String, cb: ReplyCallback<PoolSnapshot>) =
      timer.execute(Runnable { reconnectOf(PrinterPool.manager(printerId), cb) { PrinterPool.poolStatus() } })

  private fun <T> reconnectOf(manager: PrinterManager?, cb: ReplyCallback<T>, answer: () -> T) {
    if (manager == null) cb(Reply.Ok(answer())) else manager.connectAsync(manager.begin()) { cb(Reply.Ok(answer())) }
  }

  fun forget(cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          SelectionFence.begin(V1_SLOT)
          PrinterPool.removeDefault()
          cb(Reply.Ok(PrinterPool.status()))
        }
    )
  }

  fun poolForget(printerId: String, cb: ReplyCallback<PoolSnapshot>) {
    timer.execute(
        Runnable {
          SelectionFence.begin(printerId)
          PrinterPool.remove(printerId)
          cb(Reply.Ok(PrinterPool.poolStatus()))
        }
    )
  }

  /** Re-publishes (permissions may have changed) and resumes every printer that waited for Bluetooth or the screen. */
  fun refreshStatus(cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          PrinterPool.managers().forEach { it.resumeIfPaused() }
          PrinterPool.publish()
          cb(Reply.Ok(PrinterPool.status()))
        }
    )
  }

  fun onBluetoothStateChanged() {
    timer.execute(
        Runnable {
          PrinterPool.managers().forEach { it.resumeIfPaused() }
          PrinterPool.publish()
        }
    )
  }

  /** A USB device arrived: every USB printer of the list that is not connected tries again. */
  fun onUsbAttached() {
    timer.execute(
        Runnable {
          for (manager in PrinterPool.managers()) {
            if (manager.info.transport == BridgeCodes.TRANSPORT_USB && manager.connectedTransport() == null) {
              manager.connectAsync(manager.begin()) {}
            }
          }
        }
    )
  }

  /** A USB device left: the printer whose link it was loses it (two identical models are never both listed). */
  fun onUsbDetached(vendorId: Int, productId: Int) {
    timer.execute(
        Runnable {
          for (manager in PrinterPool.managers()) {
            val t = manager.activeTransport()
            if (t is UsbTransport && t.matches(vendorId, productId)) manager.onLinkLost(t)
          }
        }
    )
  }

  /** v1: one print job on the default printer. */
  fun print(base64: String, cb: ReplyCallback<Int>) {
    val manager = PrinterPool.defaultManager()
    if (manager == null) cb(Reply.fail(BridgeCodes.NOT_CONNECTED)) else manager.print(base64, cb)
  }

  /** v2: one print job on the named printer; a printer the app does not list is not connected (nothing sent). */
  fun poolPrint(printerId: String, base64: String, cb: ReplyCallback<Int>) {
    val manager = PrinterPool.manager(printerId)
    if (manager == null) cb(Reply.fail(BridgeCodes.NOT_CONNECTED)) else manager.print(base64, cb)
  }
}
