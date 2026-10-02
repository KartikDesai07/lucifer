package com.possoftware.pos.printer

import android.content.Context
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * The one active printer: state, connect and reconnect loop. Process-lifetime singleton; the
 * request entry points live in [PrinterApi].
 *
 * State is guarded by [lock], which is never held across I/O. [generation] invalidates in-flight
 * attempts when the selection changes (select, reconnect, forget).
 */
object PrinterManager {
  const val RECONNECT_STEADY_MS = 30_000L
  val RECONNECT_BACKOFF_MS: LongArray = longArrayOf(2_000L, 5_000L, 10_000L)

  private val io = PrinterThreads.io
  private val timer = PrinterThreads.timer
  private val lock = Any()
  private val publishLock = Any()
  private val known = ConcurrentHashMap<String, PrinterInfo>()
  private val linkListener = LinkListener { source -> onLinkLost(source) }

  /** The application context once [init] ran. */
  @Volatile var app: Context? = null
    private set

  /** Set from the host activity lifecycle; gates USB prompts and the background wake tick. */
  @Volatile var appVisible: Boolean = false

  /** The foreground service watches status changes here (one observer at a time). */
  @Volatile var statusObserver: ((StatusSnapshot) -> Unit)? = null

  private var selected: PrinterInfo? = null
  private var transport: PrinterTransport? = null
  private var pending: PrinterTransport? = null
  private var pendingLost = false
  private var state: String = BridgeCodes.STATE_NONE
  private var generation = 0
  private var attempts = 0
  private var btPaused = false
  private var usbPermissionPaused = false
  // The selected USB printer needs permission but the app was hidden (no dialog can show).
  // resumeIfPaused() asks again once the app is visible; not a denial, so no explicit Reconnect needed.
  private var usbWaitingForeground = false
  private var reconnectTask: ScheduledFuture<*>? = null
  private var lastPublished: StatusSnapshot? = null

  /** Idempotent. Registers receivers and reconnects the saved printer, if any. */
  fun init(context: Context) {
    val ctx = context.applicationContext
    synchronized(lock) {
      if (app != null) return
      app = ctx
    }
    PrinterReceivers.register(ctx)
    val saved = Prefs.savedPrinter(ctx) ?: return
    val gen =
        synchronized(lock) {
          selected = saved
          state = BridgeCodes.STATE_DISCONNECTED
          ++generation
        }
    io.execute(Runnable { attempt(gen) })
  }

  fun status(): StatusSnapshot {
    val ctx = app
    val bluetooth = if (ctx == null) BridgeCodes.BT_UNSUPPORTED else BtAccess.state(ctx)
    return synchronized(lock) { StatusSnapshot(state, selected, bluetooth) }
  }

  fun selectedPrinter(): PrinterInfo? = synchronized(lock) { selected }

  /** The transport of a CONNECTED printer, else null. */
  fun connectedTransport(): PrinterTransport? =
      synchronized(lock) { if (state == BridgeCodes.STATE_CONNECTED) transport else null }

  fun activeTransport(): PrinterTransport? = synchronized(lock) { transport }

  fun lookup(id: String): PrinterInfo? = known[id]

  fun remember(list: List<PrinterInfo>): List<PrinterInfo> {
    for (info in list) known[info.id] = info
    return list
  }

  fun isBluetooth(info: PrinterInfo): Boolean =
      info.transport == BridgeCodes.TRANSPORT_BT_CLASSIC ||
          info.transport == BridgeCodes.TRANSPORT_BLE

  fun closeQuietly(t: PrinterTransport) {
    try {
      t.close()
    } catch (e: RuntimeException) {
      // Closing is best effort.
    }
  }

  /**
   * Emits printer.status to the page when the snapshot changed since the last emit. The snapshot,
   * the de-dupe and both deliveries happen under [publishLock], so two threads can never deliver
   * an older state after a newer one. [lock] is only taken inside; nothing holding it publishes.
   */
  fun publish() {
    synchronized(publishLock) {
      val snapshot = status()
      synchronized(lock) {
        if (snapshot == lastPublished) return
        lastPublished = snapshot
      }
      WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS, StatusJson.toJson(snapshot))
      statusObserver?.invoke(snapshot)
    }
  }

  /** Lock held. Detaches every live transport into [into] and cancels the reconnect timer. */
  private fun collect(into: MutableList<PrinterTransport>) {
    transport?.let { into.add(it) }
    pending?.let { into.add(it) }
    transport = null
    pending = null
    pendingLost = false
    reconnectTask?.cancel(false)
    reconnectTask = null
  }

  /** Starts a new generation for [info]: aborts anything in flight and returns the generation. */
  fun begin(info: PrinterInfo): Int {
    val old = ArrayList<PrinterTransport>(2)
    val gen =
        synchronized(lock) {
          collect(old)
          selected = info
          state = BridgeCodes.STATE_DISCONNECTED
          attempts = 0
          btPaused = false
          usbPermissionPaused = false
          usbWaitingForeground = false
          ++generation
        }
    old.forEach { closeQuietly(it) }
    return gen
  }

  /** Forgets the printer: aborts everything, clears the saved choice. */
  fun halt() {
    val old = ArrayList<PrinterTransport>(2)
    synchronized(lock) {
      collect(old)
      selected = null
      state = BridgeCodes.STATE_NONE
      attempts = 0
      btPaused = false
      usbPermissionPaused = false
      usbWaitingForeground = false
      generation++
    }
    old.forEach { closeQuietly(it) }
    app?.let { Prefs.clearPrinter(it) }
    publish()
  }

  /** Runs one attempt for [gen] on the io thread; [after] runs once it settled. */
  fun connectAsync(gen: Int, after: () -> Unit) {
    io.execute(
        Runnable {
          attempt(gen)
          after()
        }
    )
  }

  /** One connect attempt for [gen] on the io thread (may block). Never throws: every failure
   *  (incl. a platform SecurityException) reports disconnected, schedules a reconnect, so callers settle. */
  private fun attempt(gen: Int) {
    val ctx = app ?: return
    val info =
        synchronized(lock) {
          if (gen != generation) return
          val current = selected ?: return
          state = BridgeCodes.STATE_CONNECTING
          current
        }
    publish()
    if (isBluetooth(info) && BtAccess.state(ctx) != BridgeCodes.BT_ON) {
      synchronized(lock) {
        if (gen != generation) return
        state = BridgeCodes.STATE_DISCONNECTED
        btPaused = true
      }
      publish()
      return
    }
    val t =
        try {
          TransportFactory.create(ctx, info, linkListener, timer) { appVisible }
        } catch (e: Exception) {
          failed(gen, null)
          return
        }
    synchronized(lock) {
      if (gen != generation) return
      pending = t
      pendingLost = false
    }
    try {
      t.open()
    } catch (e: Exception) {
      closeQuietly(t)
      if (info.transport == BridgeCodes.TRANSPORT_USB && e is TransportException && e.code == BridgeCodes.UNAUTHORIZED) {
        synchronized(lock) {
          if (gen != generation) return
          pending = null
          state = BridgeCodes.STATE_DISCONNECTED
          // Hidden app: ask again when visible. A real denial (the dialog was shown and refused)
          // waits for an explicit Reconnect: never a prompt loop.
          if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true
        }
        publish()
        return
      }
      failed(gen, t)
      return
    }
    val outcome =
        synchronized(lock) {
          if (gen != generation) {
            Outcome.STALE
          } else if (pendingLost) {
            pendingLost = false
            Outcome.LOST
          } else {
            pending = null
            transport = t
            attempts = 0
            state = BridgeCodes.STATE_CONNECTED
            Outcome.CONNECTED
          }
        }
    when (outcome) {
      Outcome.CONNECTED -> publish()
      Outcome.STALE -> closeQuietly(t)
      // The link dropped between open() returning and the claim: not connected after all.
      Outcome.LOST -> {
        closeQuietly(t)
        failed(gen, t)
      }
    }
  }

  private enum class Outcome { STALE, LOST, CONNECTED }

  private fun failed(gen: Int, t: PrinterTransport?) {
    synchronized(lock) {
      if (gen != generation) return
      if (pending === t) pending = null
      state = BridgeCodes.STATE_DISCONNECTED
    }
    publish()
    scheduleReconnect(gen)
  }

  private fun scheduleReconnect(gen: Int) {
    val ctx = app ?: return
    synchronized(lock) {
      val info = selected
      if (gen != generation || info == null || usbPermissionPaused || usbWaitingForeground) return
      if (isBluetooth(info) && BtAccess.state(ctx) != BridgeCodes.BT_ON) {
        btPaused = true
        return
      }
      val delay =
          if (attempts < RECONNECT_BACKOFF_MS.size) {
            RECONNECT_BACKOFF_MS[attempts]
          } else {
            RECONNECT_STEADY_MS
          }
      attempts++
      reconnectTask?.cancel(false)
      reconnectTask =
          timer.schedule(
              Runnable { io.execute(Runnable { attempt(gen) }) },
              delay,
              TimeUnit.MILLISECONDS,
          )
    }
  }

  /** An established link dropped (or a write failed): report honestly, then reconnect. */
  fun onLinkLost(source: PrinterTransport) {
    val gen =
        synchronized(lock) {
          if (source === pending) {
            // Dropped before the attempt claimed it: the attempt marks itself failed.
            pendingLost = true
            return
          }
          if (source !== transport) return
          transport = null
          state = BridgeCodes.STATE_DISCONNECTED
          generation
        }
    closeQuietly(source)
    publish()
    scheduleReconnect(gen)
  }

  /** Bluetooth came back (or permission was granted) while a printer waited for it. */
  fun resumeIfPaused() {
    val ctx = app ?: return
    // A USB printer that needed permission while the app was hidden asks once the app is visible.
    val usbInfo = synchronized(lock) { if (usbWaitingForeground && appVisible) selected else null }
    if (usbInfo != null) {
      val gen = begin(usbInfo)
      connectAsync(gen) {}
      return
    }
    val lost = synchronized(lock) {
      val info = selected
      if (info != null && isBluetooth(info) && BtAccess.state(ctx) != BridgeCodes.BT_ON) {
        btPaused = true
        transport
      } else null
    }
    if (lost != null) onLinkLost(lost)
    val info = synchronized(lock) { if (btPaused) selected else null } ?: return
    if (BtAccess.state(ctx) == BridgeCodes.BT_ON) {
      val gen = begin(info)
      connectAsync(gen) {}
    }
  }
}
