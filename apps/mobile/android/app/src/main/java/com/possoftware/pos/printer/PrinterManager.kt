package com.possoftware.pos.printer

import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One printer of the app's list: its state, its connect and reconnect loop, and its prints. Phase 2 Session 2F2
 * (spec §9.2): every printer has a manager of its own with its own io executor ([io]), so a blocked Bluetooth
 * Classic connect or a USB permission wait never stalls another printer, and BUSY is per printer. [PrinterPool]
 * keeps the list and publishes; [PrinterApi] holds the request entry points.
 *
 * State is guarded by [lock], which is never held across I/O or while telling the pool something changed
 * ([PrinterEnv.changed]). [generation] invalidates in-flight attempts when this printer is begun again (select,
 * reconnect) or halted (it left the list). Nothing here touches Android: [env] carries every platform call, so this
 * state machine runs in JVM unit tests (src/test).
 *
 * Phase 3 Session 3C (spec §10): while connected it asks the printer's own status (DLE EOT, [PrinterTransport.status])
 * after each job and every [STATUS_PROBE_MS] while idle ([STATUS_PROBE_PROBLEM_MS] while the printer says it cannot
 * print), on its io thread, so never during a job. A network printer's idle check is a connect too, so one switched off
 * between jobs reads disconnected within a minute. A printer that says it cannot print refuses a job BUSY before any byte.
 */
class PrinterManager(val info: PrinterInfo, private val env: PrinterEnv, private val io: ExecutorService) {
  companion object {
    const val RECONNECT_STEADY_MS = 30_000L
    val RECONNECT_BACKOFF_MS: LongArray = longArrayOf(2_000L, 5_000L, 10_000L)
    const val PRINT_JOB_TIMEOUT_MS = 60_000L

    /** Session 3C (spec §10): an idle printer's status is asked this often (a network printer: one connect and close). */
    const val STATUS_PROBE_MS = 60_000L

    /** ...and this often while it says it cannot print (out of paper, cover open, an error), so it prints again soon after
     *  staff fix it. */
    const val STATUS_PROBE_PROBLEM_MS = 10_000L

    /** The wait before reconnect attempt number [attempts] (0-based): 2 s, 5 s, 10 s, then every 30 s. */
    fun backoffMs(attempts: Int): Long =
        if (attempts < RECONNECT_BACKOFF_MS.size) RECONNECT_BACKOFF_MS[attempts] else RECONNECT_STEADY_MS

    fun isBluetooth(info: PrinterInfo): Boolean =
        info.transport == BridgeCodes.TRANSPORT_BT_CLASSIC || info.transport == BridgeCodes.TRANSPORT_BLE

    fun closeQuietly(t: PrinterTransport) {
      try {
        t.close()
      } catch (e: RuntimeException) {
        // Closing is best effort.
      }
    }
  }

  private val lock = Any()
  private val printing = AtomicBoolean(false)
  private val linkListener = LinkListener { source -> onLinkLost(source) }

  private var transport: PrinterTransport? = null
  private var pending: PrinterTransport? = null
  private var pendingLost = false
  // A manager is made only to be started at once (init, a select), and begin() is always followed by connectAsync():
  // it reads as connecting until its first attempt settles, so a select's first event is {connecting} as on v1.
  private var state: String = BridgeCodes.STATE_CONNECTING
  private var generation = 0
  private var attempts = 0
  private var halted = false
  private var btPaused = false
  private var usbPermissionPaused = false
  // This USB printer needs permission but the app was hidden (no dialog can show). resumeIfPaused() asks
  // again once the app is visible; not a denial, so no explicit Reconnect is needed.
  private var usbWaitingForeground = false
  private var reconnectTask: Cancel? = null
  private var probeTask: Cancel? = null
  // Session 3C: what the printer last said of itself on this link (DLE EOT), or null.
  private var health: PrinterHealth? = null

  val id: String
    get() = info.id

  /** This printer's state as the page reads it ("none" only once it left the list). */
  fun state(): String = synchronized(lock) { state }

  /** The transport of a CONNECTED printer, else null. */
  fun connectedTransport(): PrinterTransport? =
      synchronized(lock) { if (state == BridgeCodes.STATE_CONNECTED) transport else null }

  fun activeTransport(): PrinterTransport? = synchronized(lock) { transport }

  /** Session 3C (spec §10): what a CONNECTED printer last said of itself (DLE EOT), else null. */
  fun health(): PrinterHealth? = synchronized(lock) { if (state == BridgeCodes.STATE_CONNECTED) health else null }

  /** Lock held. Detaches every live transport into [into] and cancels the reconnect timer. */
  private fun collect(into: MutableList<PrinterTransport>) {
    transport?.let { into.add(it) }
    pending?.let { into.add(it) }
    transport = null
    pending = null
    pendingLost = false
    reconnectTask?.cancel()
    reconnectTask = null
    probeTask?.cancel()
    probeTask = null
    health = null
  }

  /** Starts a new generation: aborts anything in flight and returns the generation. */
  fun begin(): Int {
    val old = ArrayList<PrinterTransport>(2)
    val gen =
        synchronized(lock) {
          collect(old)
          if (!halted) state = BridgeCodes.STATE_CONNECTING
          attempts = 0
          btPaused = false
          usbPermissionPaused = false
          usbWaitingForeground = false
          ++generation
        }
    old.forEach { closeQuietly(it) }
    return gen
  }

  /** This printer left the list: aborts everything, and its io executor takes no new work. */
  fun halt() {
    val old = ArrayList<PrinterTransport>(2)
    synchronized(lock) {
      collect(old)
      halted = true
      state = BridgeCodes.STATE_NONE
      attempts = 0
      btPaused = false
      usbPermissionPaused = false
      usbWaitingForeground = false
      generation++
    }
    old.forEach { closeQuietly(it) }
    io.shutdown()
  }

  /** Queues [task] on this printer's io thread; false once the printer was halted (nothing will run). */
  private fun onIo(task: () -> Unit): Boolean =
      try {
        io.execute(Runnable { task() })
        true
      } catch (e: RejectedExecutionException) {
        false
      }

  /** Runs one attempt for [gen] on the io thread; [after] runs once it settled (at once when halted). */
  fun connectAsync(gen: Int, after: () -> Unit) {
    val queued =
        onIo {
          attempt(gen)
          after()
        }
    if (!queued) after()
  }

  /** Session 3C (the 2G review's m-3): runs [after] once the work queued on this printer's io thread so far has run (an
   *  attempt in flight settles first); at once when the printer was halted. */
  fun afterIo(after: () -> Unit) {
    if (!onIo { after() }) after()
  }

  /** One connect attempt for [gen] on the io thread (may block). Never throws: every failure (incl. a platform
   *  SecurityException) reports disconnected and schedules a reconnect, so callers settle. */
  private fun attempt(gen: Int) {
    synchronized(lock) {
      if (gen != generation || halted) return
      state = BridgeCodes.STATE_CONNECTING
    }
    env.changed()
    if (isBluetooth(info) && !env.bluetoothOn()) {
      synchronized(lock) {
        if (gen != generation) return
        state = BridgeCodes.STATE_DISCONNECTED
        btPaused = true
      }
      env.changed()
      return
    }
    val t =
        try {
          env.transport(info, linkListener)
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
        env.changed()
        // Cold start: initialize() starts this attempt just before onHostResume, so the app can turn
        // visible between open()'s check and the flag above; that resume found nothing to ask for.
        // Ask now, on the timer thread every other resumeIfPaused() caller uses.
        if (e.needsForeground && env.visible()) env.onTimer(Runnable { resumeIfPaused() })
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
      Outcome.CONNECTED -> {
        // Session 3C: what the printer says of itself, once connected (then on the idle timer). The 3C review gate (m-6,
        // and its review's m-5): its own io task, queued before anyone hears "connected", so a select's answer never
        // waits for it and it runs before any job, even one that claimed this printer meanwhile.
        onIo { probe(gen, force = true) }
        env.changed()
      }
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
    env.changed()
    scheduleReconnect(gen)
  }

  private fun scheduleReconnect(gen: Int) {
    synchronized(lock) {
      if (gen != generation || halted || usbPermissionPaused || usbWaitingForeground) return
      if (isBluetooth(info) && !env.bluetoothOn()) {
        btPaused = true
        return
      }
      val delay = backoffMs(attempts)
      attempts++
      reconnectTask?.cancel()
      reconnectTask = env.schedule(delay, Runnable { onIo { attempt(gen) } })
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
          health = null
          probeTask?.cancel()
          probeTask = null
          generation
        }
    closeQuietly(source)
    env.changed()
    scheduleReconnect(gen)
  }

  /** Bluetooth came back (or permission was granted, or the app is visible again) while this printer waited. */
  fun resumeIfPaused() {
    // A USB printer that needed permission while the app was hidden asks once the app is visible.
    val usbAsk = synchronized(lock) { !halted && usbWaitingForeground && env.visible() }
    if (usbAsk) {
      connectAsync(begin()) {}
      return
    }
    val lost =
        synchronized(lock) {
          if (!halted && isBluetooth(info) && !env.bluetoothOn()) {
            btPaused = true
            transport
          } else null
        }
    if (lost != null) onLinkLost(lost)
    val resume = synchronized(lock) { !halted && btPaused }
    if (resume && env.bluetoothOn()) connectAsync(begin()) {}
  }

  /**
   * One print job at a time on THIS printer (BUSY is per printer, so a v1 and a v2 print aimed at it are
   * serialized, never interleaved); a failed or partial write is never replayed here. BUSY and NOT_CONNECTED
   * are answered before any byte is sent.
   */
  fun print(base64: String, cb: ReplyCallback<Int>) {
    if (!printing.compareAndSet(false, true)) {
      cb(Reply.fail(BridgeCodes.BUSY))
      return
    }
    val t = connectedTransport()
    if (t == null) {
      printing.set(false)
      cb(Reply.fail(BridgeCodes.NOT_CONNECTED))
      return
    }
    // Session 3C (spec §10): a printer that says it cannot print (out of paper, cover open, an error) refuses before any
    // byte, as BUSY: the slip waits, every device says why, and it prints once the printer says it is ready again.
    if (synchronized(lock) { health?.cannotPrint() == true }) {
      printing.set(false)
      cb(Reply.fail(BridgeCodes.BUSY))
      return
    }
    val queued =
        onIo {
          // The 3C review gate (m-1): a job queued behind one whose printer said it cannot print (its status, read
          // below) is refused here, still before any byte.
          if (synchronized(lock) { health?.cannotPrint() == true }) {
            printing.set(false)
            cb(Reply.fail(BridgeCodes.BUSY))
            return@onIo
          }
          val reply = runPrint(t, base64)
          printing.set(false)
          cb(reply)
          // Session 3C (spec §10): what the printer says after the job (a network printer: what the job's own connection
          // read, G5), before the next job: read even when the next job already claimed this printer (m-1).
          synchronized(lock) { if (transport === t) generation else null }?.let { probe(it, force = true) }
        }
    if (!queued) {
      printing.set(false)
      cb(Reply.fail(BridgeCodes.NOT_CONNECTED))
    }
  }

  /**
   * The job and its watchdog race for one claim (Session 3C: the 2F2 gold review's M-5), so exactly one of them decides:
   * a job that finished first is never closed under, and a watchdog that fired first always makes it a TIMEOUT. A timer's
   * cancel() can still win while the watchdog's task runs; the claim, not cancel(), decides.
   */
  private fun runPrint(t: PrinterTransport, base64: String): Reply<Int> {
    val bytes = env.decode(base64) ?: return Reply.fail(BridgeCodes.BAD_REQUEST)
    val claim = AtomicBoolean(false)
    val watchdog =
        env.schedule(
            PRINT_JOB_TIMEOUT_MS,
            Runnable { if (claim.compareAndSet(false, true)) closeQuietly(t) },
        )
    return try {
      t.write(bytes)
      if (!claim.compareAndSet(false, true)) {
        // The job ran into the watchdog: the link was closed under it, so it never counts as printed.
        onLinkLost(t)
        Reply.fail(BridgeCodes.TIMEOUT)
      } else {
        Reply.Ok(bytes.size)
      }
    } catch (e: TransportException) {
      val timedOut = !claim.compareAndSet(false, true)
      // Session 3C (G5): a printer that took the job in but says it cannot print keeps its link; anything else lost it.
      if (timedOut || !e.linkKept) onLinkLost(t)
      Reply.fail(if (timedOut) BridgeCodes.TIMEOUT else e.code)
    } catch (e: RuntimeException) {
      val timedOut = !claim.compareAndSet(false, true)
      onLinkLost(t)
      Reply.fail(if (timedOut) BridgeCodes.TIMEOUT else BridgeCodes.WRITE_FAILED)
    } finally {
      watchdog.cancel()
    }
  }

  /**
   * Session 3C (spec §10): asks the printer's status on the io thread (called there), keeps what it said (published when
   * it changed), then asks again after [STATUS_PROBE_MS], or [STATUS_PROBE_PROBLEM_MS] while it says it cannot print.
   * Skipped while a job waits or prints (that job's own status answers it), unless [force]d: the check at the connect
   * and the one right after a job, which run on the io thread ahead of any job that claimed the printer meanwhile (the 3C
   * review gate, m-1, m-6). A link that no longer answers is lost (the reconnect loop takes over). A stale [gen] does
   * nothing.
   */
  private fun probe(gen: Int, force: Boolean = false) {
    val t = synchronized(lock) { if (gen != generation || halted || state != BridgeCodes.STATE_CONNECTED) null else transport } ?: return
    if (!force && printing.get()) {
      scheduleProbe(gen)
      return
    }
    val said =
        try {
          t.status()
        } catch (e: TransportException) {
          onLinkLost(t)
          return
        } catch (e: RuntimeException) {
          null
        }
    val changed =
        synchronized(lock) {
          if (gen != generation || transport !== t) return
          val was = health
          health = said
          was != said
        }
    if (changed) env.changed()
    scheduleProbe(gen)
  }

  private fun scheduleProbe(gen: Int) {
    synchronized(lock) {
      if (gen != generation || halted || state != BridgeCodes.STATE_CONNECTED) return
      probeTask?.cancel()
      val wait = if (health?.cannotPrint() == true) STATUS_PROBE_PROBLEM_MS else STATUS_PROBE_MS
      // A job that waits now asks its own status after it; the idle check waits a full period again.
      probeTask = env.schedule(wait, Runnable { if (printing.get()) scheduleProbe(gen) else onIo { probe(gen) } })
    }
  }
}
