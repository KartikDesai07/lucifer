package com.possoftware.pos.printer

import android.content.Context
import android.util.Base64
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Request entry points for the module and the system receivers. Every call returns at once and
 * does its work on the timer thread (never blocks) or the io thread (connect/write).
 */
object PrinterApi {
  const val PRINT_JOB_TIMEOUT_MS = 60_000L

  private val timer = PrinterThreads.timer
  private val io = PrinterThreads.io
  private val printing = AtomicBoolean(false)

  fun listPrinters(scan: Boolean, cb: ReplyCallback<List<PrinterInfo>>) {
    timer.execute(
        Runnable {
          val ctx = PrinterManager.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
          } else if (!scan) {
            cb(Reply.Ok(PrinterManager.remember(PrinterDiscovery.known(ctx))))
          } else if (!BtAccess.hasScan(ctx) || !BtAccess.hasConnect(ctx)) {
            cb(Reply.fail(BridgeCodes.UNAUTHORIZED))
          } else if (BtAccess.locationOff(ctx)) {
            cb(Reply.fail(BridgeCodes.LOCATION_OFF))
          } else {
            val started =
                PrinterDiscovery.scan(ctx) { list ->
                  timer.execute(Runnable { cb(Reply.Ok(PrinterManager.remember(list))) })
                }
            if (!started) cb(Reply.fail(BridgeCodes.BUSY))
          }
        }
    )
  }

  fun selectPrinter(id: String, cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          val ctx = PrinterManager.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
            return@Runnable
          }
          val info = PrinterManager.lookup(id) ?: PrinterDiscovery.infoFromId(ctx, id)
          if (info == null) cb(Reply.fail(BridgeCodes.BAD_REQUEST)) else select(ctx, info, cb)
        }
    )
  }

  fun selectTcp(host: String, port: Int, cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          val ctx = PrinterManager.app
          if (ctx == null) {
            cb(Reply.fail(BridgeCodes.UNSUPPORTED))
          } else if (!PrinterIds.validHost(host) || !PrinterIds.validPort(port)) {
            cb(Reply.fail(BridgeCodes.BAD_REQUEST))
          } else {
            select(ctx, PrinterDiscovery.tcpInfo(ctx, host, port), cb)
          }
        }
    )
  }

  /** Saves the choice, then settles after the first attempt (connected or disconnected). */
  private fun select(ctx: Context, info: PrinterInfo, cb: ReplyCallback<StatusSnapshot>) {
    // A newer selection aborts the lookup of an older one before anything else happens.
    val ticket = SelectionFence.begin()
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
      fenceThenCommit(ctx, info, ticket, cb)
    } else {
      commit(ctx, info, cb)
    }
  }

  /**
   * Checks a network host on the dns thread (DNS blocks; never the io thread). A non-private
   * address is BAD_REQUEST, and a selection made newer meanwhile is not committed.
   */
  private fun fenceThenCommit(
      ctx: Context,
      info: PrinterInfo,
      ticket: Int,
      cb: ReplyCallback<StatusSnapshot>,
  ) {
    val target = PrinterIds.tcpOf(info.id)
    if (target == null) {
      cb(Reply.fail(BridgeCodes.BAD_REQUEST))
      return
    }
    SelectionFence.check(target.first, ticket, cb) { commit(ctx, info, cb) }
  }

  private fun commit(ctx: Context, info: PrinterInfo, cb: ReplyCallback<StatusSnapshot>) {
    Prefs.savePrinter(ctx, info)
    val gen = PrinterManager.begin(info)
    PrinterManager.connectAsync(gen) { cb(Reply.Ok(PrinterManager.status())) }
  }

  fun reconnect(cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          val info = PrinterManager.selectedPrinter()
          if (info == null) {
            cb(Reply.Ok(PrinterManager.status()))
          } else {
            val gen = PrinterManager.begin(info)
            PrinterManager.connectAsync(gen) { cb(Reply.Ok(PrinterManager.status())) }
          }
        }
    )
  }

  fun forget(cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          SelectionFence.begin()
          PrinterManager.halt()
          cb(Reply.Ok(PrinterManager.status()))
        }
    )
  }

  /** Re-publishes (permissions may have changed) and resumes a Bluetooth-paused printer. */
  fun refreshStatus(cb: ReplyCallback<StatusSnapshot>) {
    timer.execute(
        Runnable {
          PrinterManager.resumeIfPaused()
          PrinterManager.publish()
          cb(Reply.Ok(PrinterManager.status()))
        }
    )
  }

  fun onBluetoothStateChanged() {
    timer.execute(
        Runnable {
          PrinterManager.resumeIfPaused()
          PrinterManager.publish()
        }
    )
  }

  fun onUsbAttached() {
    timer.execute(
        Runnable {
          val info = PrinterManager.selectedPrinter()
          val idle = PrinterManager.connectedTransport() == null
          if (idle && info != null && info.transport == BridgeCodes.TRANSPORT_USB) {
            val gen = PrinterManager.begin(info)
            PrinterManager.connectAsync(gen) {}
          }
        }
    )
  }

  fun onUsbDetached(vendorId: Int, productId: Int) {
    timer.execute(
        Runnable {
          val t = PrinterManager.activeTransport()
          if (t is UsbTransport && t.matches(vendorId, productId)) PrinterManager.onLinkLost(t)
        }
    )
  }

  /** One print job at a time; no native resend (the web resends once). */
  fun print(base64: String, cb: ReplyCallback<Int>) {
    if (!printing.compareAndSet(false, true)) {
      cb(Reply.fail(BridgeCodes.BUSY))
      return
    }
    val t = PrinterManager.connectedTransport()
    if (t == null) {
      printing.set(false)
      cb(Reply.fail(BridgeCodes.NOT_CONNECTED))
      return
    }
    io.execute(
        Runnable {
          val reply = runPrint(t, base64)
          printing.set(false)
          cb(reply)
        }
    )
  }

  /** True when the watchdog already started: cancel only wins while it has not run. */
  private fun watchdogFired(watchdog: ScheduledFuture<*>, timedOut: AtomicBoolean): Boolean =
      !watchdog.cancel(false) || timedOut.get()

  private fun runPrint(t: PrinterTransport, base64: String): Reply<Int> {
    val bytes =
        try {
          Base64.decode(base64, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
          return Reply.fail(BridgeCodes.BAD_REQUEST)
        }
    val timedOut = AtomicBoolean(false)
    val watchdog =
        timer.schedule(
            Runnable {
              timedOut.set(true)
              PrinterManager.closeQuietly(t)
            },
            PRINT_JOB_TIMEOUT_MS,
            TimeUnit.MILLISECONDS,
        )
    return try {
      t.write(bytes)
      if (watchdogFired(watchdog, timedOut)) {
        // The job ran into the watchdog: the link was closed under it, so it never counts as printed.
        PrinterManager.onLinkLost(t)
        Reply.fail(BridgeCodes.TIMEOUT)
      } else {
        Reply.Ok(bytes.size)
      }
    } catch (e: TransportException) {
      PrinterManager.onLinkLost(t)
      Reply.fail(if (timedOut.get()) BridgeCodes.TIMEOUT else e.code)
    } catch (e: RuntimeException) {
      PrinterManager.onLinkLost(t)
      Reply.fail(if (timedOut.get()) BridgeCodes.TIMEOUT else BridgeCodes.WRITE_FAILED)
    } finally {
      watchdog.cancel(false)
    }
  }
}
