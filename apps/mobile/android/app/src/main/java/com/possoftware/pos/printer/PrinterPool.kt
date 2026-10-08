package com.possoftware.pos.printer

import android.content.Context
import android.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The app's printers (Phase 2 Session 2F2, spec §9.2): one [PrinterManager] per printer, in a list kept in [Prefs]
 * with a default printer that every v1 message acts on, and the one place that publishes printer.status to the
 * page: the v1 event (the default printer's status) and the v2 event (every printer), each only when what it
 * carries changed. Process-lifetime singleton; the request entry points live in [PrinterApi].
 *
 * [poolLock] guards the list; it is held to read the list and each listed printer's state, or to change the list,
 * never while a manager works or while publishing. Lock order: [publishLock], then [poolLock], then a manager's own
 * lock (no manager takes the pool's lock).
 *
 * Session 3C (the 2F2 gate's publish-chain test): where a change is saved ([saver]) and where a status event goes
 * ([publisher]) are seams, the app's own by default, so a JVM test (src/test) proves change, halt, save, then publish.
 */
object PrinterPool {
  private val poolLock = Any()
  private val publishLock = Any()
  private val list = PoolList<PrinterManager> { it.id }
  private val known = ConcurrentHashMap<String, PrinterInfo>()
  private val dedupe = StatusDedupe()

  /** The application context once [init] ran. */
  @Volatile var app: Context? = null
    private set

  /** Set from the host activity lifecycle; gates USB prompts and the background wake tick. */
  @Volatile var appVisible: Boolean = false

  /** The foreground service watches status changes here (one observer at a time). */
  @Volatile var statusObserver: (() -> Unit)? = null

  /** Session 3C: saves the list and its default (the app's: [Prefs], once [init] ran). */
  @Volatile
  internal var saver: (List<PrinterInfo>, String?) -> Unit = { printers, defaultId ->
    app?.let { Prefs.savePrinters(it, printers, defaultId) }
  }

  /** Session 3C: delivers what changed: the v1 event (the default printer) and the v2 event (every printer), each only
   *  when it changed (null otherwise). The app's: the page's printer.status events. */
  @Volatile
  internal var publisher: (StatusSnapshot?, PoolSnapshot?) -> Unit = { one, all ->
    if (one != null) WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS, StatusJson.toJson(one))
    if (all != null) WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS, StatusJson.poolJson(all), BridgeCodes.BRIDGE_V2)
  }

  private val env =
      object : PrinterEnv {
        override fun bluetoothOn(): Boolean = app?.let { BtAccess.state(it) == BridgeCodes.BT_ON } ?: false

        override fun visible(): Boolean = appVisible

        override fun transport(info: PrinterInfo, listener: LinkListener): PrinterTransport {
          val ctx = app ?: throw TransportException(BridgeCodes.UNSUPPORTED, "Not started")
          return TransportFactory.create(ctx, info, listener, PrinterThreads.timer) { appVisible }
        }

        override fun schedule(delayMs: Long, task: Runnable): Cancel {
          val future = PrinterThreads.timer.schedule(task, delayMs, TimeUnit.MILLISECONDS)
          return Cancel { future.cancel(false) }
        }

        override fun onTimer(task: Runnable) = PrinterThreads.timer.execute(task)

        override fun decode(base64: String): ByteArray? =
            try {
              Base64.decode(base64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
              null
            }

        override fun changed() = publish()
      }

  private fun newManager(info: PrinterInfo): PrinterManager = PrinterManager(info, env, PrinterThreads.newIo())

  /** Idempotent. Registers receivers and reconnects every saved printer. */
  fun init(context: Context) {
    val ctx = context.applicationContext
    synchronized(poolLock) {
      if (app != null) return
      app = ctx
    }
    PrinterReceivers.register(ctx)
    val saved = Prefs.savedPrinters(ctx)
    val managers =
        synchronized(poolLock) {
          for (info in saved.all()) list.put(newManager(info))
          saved.defaultId?.let { list.makeDefault(it) }
          list.all()
        }
    // The list may have been migrated from the one v1 printer, or follow an older app's change of it.
    save()
    for (manager in managers) manager.connectAsync(manager.begin()) {}
  }

  private fun bluetooth(): String {
    val ctx = app
    return if (ctx == null) BridgeCodes.BT_UNSUPPORTED else BtAccess.state(ctx)
  }

  /** The v1 printer.status: the default printer's. Read under [poolLock], so a printer a forget or a select is
   *  retiring is never read after its halt (a state v1 never sent: "none" with a printer). */
  fun status(): StatusSnapshot {
    val bluetooth = bluetooth()
    return synchronized(poolLock) { list.default()?.let { StatusSnapshot(it.state(), it.info, bluetooth) } }
        ?: StatusSnapshot(BridgeCodes.STATE_NONE, null, bluetooth)
  }

  /** The v2 printer.status: every printer in the app's order, and the default (read under [poolLock], as [status]).
   *  Session 3C (spec §10): each with what it last said of itself while connected (DLE EOT). */
  fun poolStatus(): PoolSnapshot {
    val bluetooth = bluetooth()
    return synchronized(poolLock) { PoolSnapshot(list.all().map { PoolEntry(it.state(), it.info, it.health()) }, list.defaultId, bluetooth) }
  }

  fun manager(id: String): PrinterManager? = synchronized(poolLock) { list.find(id) }

  fun defaultManager(): PrinterManager? = synchronized(poolLock) { list.default() }

  fun managers(): List<PrinterManager> = synchronized(poolLock) { list.all() }

  /** v2 select: [info] joins the list, its printer started anew (a listed one is replaced in its place). */
  fun add(info: PrinterInfo): PrinterManager {
    val manager = newManager(info)
    change { it.put(manager) }
    return manager
  }

  /** A printer a select names, and whether its manager is new (only a new one is connected by the caller). */
  data class Selected(val manager: PrinterManager, val fresh: Boolean)

  /** v1 select: [info] becomes the default printer in the default's place, as v1 always replaced its one printer.
   *  Session 3C (the 2G review's m-3): a printer already listed only becomes the default: its manager, its link and its
   *  loop stay, so Change printer to a printer the page has just added connects it once, never twice. */
  fun replaceDefault(info: PrinterInfo): Selected {
    var selected: Selected? = null
    change { pool ->
      val listed = pool.find(info.id)
      if (listed != null) {
        pool.makeDefault(info.id)
        selected = Selected(listed, false)
        emptyList()
      } else {
        val manager = newManager(info)
        selected = Selected(manager, true)
        pool.putDefault(manager)
      }
    }
    return selected ?: throw IllegalStateException("no selection")
  }

  /** v2 forget: [id] leaves the list (the default leaving promotes the first remaining printer). */
  fun remove(id: String) = change { listOfNotNull(it.remove(id)) }

  /** v1 forget: the default printer leaves the list. */
  fun removeDefault() = change { pool -> listOfNotNull(pool.defaultId?.let { pool.remove(it) }) }

  /** Changes the list, retires the printers that left it, saves, then publishes (never under [poolLock]). */
  private fun change(edit: (PoolList<PrinterManager>) -> List<PrinterManager>) {
    val retired = synchronized(poolLock) { edit(list) }
    retired.forEach { it.halt() }
    save()
    publish()
  }

  private fun save() {
    val (printers, defaultId) = synchronized(poolLock) { Pair(list.all().map { it.info }, list.defaultId) }
    saver(printers, defaultId)
  }

  fun lookup(id: String): PrinterInfo? = known[id]

  fun remember(found: List<PrinterInfo>): List<PrinterInfo> {
    for (info in found) known[info.id] = info
    return found
  }

  /**
   * Emits printer.status to the page when what it carries changed since the last emit: v1 (the default printer)
   * and v2 (every printer) apart. The snapshots, the de-dupe and every delivery happen under [publishLock], so two
   * threads can never deliver an older state after a newer one. [poolLock] is only taken inside.
   */
  fun publish() {
    synchronized(publishLock) {
      val one = status()
      val all = poolStatus()
      val changes = dedupe.next(one, all)
      if (changes.v1 || changes.v2) publisher(if (changes.v1) one else null, if (changes.v2) all else null)
      if (changes.v1 || changes.v2) statusObserver?.invoke()
    }
  }
}
