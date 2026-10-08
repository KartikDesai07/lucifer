package com.possoftware.pos.printer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.possoftware.pos.R
import org.json.JSONObject

/**
 * Foreground service (type connectedDevice) that keeps the process, the printer link and the page
 * alive while the screen is off. Started only from the foreground; the tick wakes the page.
 *
 * Phase 3 Session 3D (spec §9.5): sticky. When Android restarts it after its process died, the page died too, so it says
 * "POS printing is off. Tap to start." and stops; so does a stop the page did not ask for ([HostLife]).
 */
class PrintHostService : Service() {

  companion object {
    const val ACTION_START = HostLife.ACTION_START
    const val EXTRA_LABEL = "label"
    const val CHANNEL_ID = "print_host"
    const val ALERT_CHANNEL_ID = "print_host_alert"
    const val NOTIFICATION_ID = 4101
    const val APP_WAKE_TICK_MS = 15_000L
    const val WAKE_LOCK_TIMEOUT_MS = 60_000L

    /** Consecutive ticks with an unanswered or wrong page probe before the alert replaces the notification. */
    const val PAGE_DEAD_TICKS = 2

    /** Session 3D (spec §9.5): at most one remount of a dead page every 10 minutes (40 ticks of 15 s). */
    const val PAGE_REMOUNT_GAP_TICKS = 40
    private const val WAKE_LOCK_TAG = "PosSoftware:PrintHost"
    private const val NO_FOREGROUND_TYPE = 0
    private const val ALERT_KEY = "page-dead"

    // A service started with startForegroundService must call startForeground before it is
    // stopped, or Android crashes the app. So stop() only stops a service that is already
    // foreground; otherwise it leaves [stopWanted] for onStartCommand to act on.
    @Volatile private var stopWanted = false
    @Volatile private var foregroundReached = false

    fun start(ctx: Context, label: String) {
      stopWanted = false
      foregroundReached = false
      val intent = Intent(ctx, PrintHostService::class.java)
      intent.action = ACTION_START
      intent.putExtra(EXTRA_LABEL, label)
      ContextCompat.startForegroundService(ctx, intent)
    }

    fun stop(ctx: Context) {
      stopWanted = true
      if (foregroundReached) {
        foregroundReached = false
        ctx.stopService(Intent(ctx, PrintHostService::class.java))
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var label = ""
  private var shownKey = ""
  // Session 3D: it ran in the foreground for the page (so its stop may need the "printing is off" notice).
  private var running = false

  // Page liveness (main thread only): each tick scores the previous tick's probe, then sends one.
  private var probeSeq = 0
  private val watch = PageWatch(PAGE_DEAD_TICKS, PAGE_REMOUNT_GAP_TICKS)

  private val tick =
      object : Runnable {
        override fun run() {
          renewWakeLock()
          if (!PrinterPool.appVisible) {
            WebViewDelivery.keepPageRunning()
            WebViewDelivery.deliverEvent(BridgeCodes.EVENT_APP_WAKE, JSONObject())
          }
          probePage()
          refreshNotification()
          handler.postDelayed(this, APP_WAKE_TICK_MS)
        }
      }

  private fun probePage() {
    // Session 3D (spec §9.5): a page that stopped answering while nobody looks at the app is remounted ([PageWatch]).
    if (watch.tick(PrinterPool.appVisible)) HostPage.remount?.invoke()
    val id = ++probeSeq
    // A late answer to an older probe must not vouch for this one.
    WebViewDelivery.probePage { alive -> if (alive && id == probeSeq) watch.answered() }
  }

  /** The page has stopped answering and nobody is looking at the app, so only a notification can say so. */
  private fun alerting(): Boolean = watch.alerting(PrinterPool.appVisible)

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
    PrinterPool.statusObserver = { handler.post { refreshNotification() } }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (HostLife.onStart(intent?.action, Prefs.printing(this))) {
      HostLife.Start.NOTICE_THEN_STOP -> {
        PrintingOffNotice.post(this)
        stopSelf(startId)
        return START_NOT_STICKY
      }
      HostLife.Start.STOP -> {
        stopSelf(startId)
        return START_NOT_STICKY
      }
      HostLife.Start.RUN -> Unit
    }
    label = intent?.getStringExtra(EXTRA_LABEL).orEmpty()
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundType())
    } catch (e: RuntimeException) {
      // Not allowed to run as a foreground service right now (app not visible, or a missing prerequisite).
      stopSelf(startId)
      return START_NOT_STICKY
    }
    foregroundReached = true
    if (stopWanted) {
      // A stop arrived before this service was foreground; it is safe to stop now. stopSelf(startId)
      // leaves a newer start command (a restart racing this stop) running.
      stopSelf(startId)
      return START_NOT_STICKY
    }
    running = true
    PrintingOffNotice.cancel(this)
    watch.start()
    renewWakeLock()
    handler.removeCallbacks(tick)
    handler.postDelayed(tick, APP_WAKE_TICK_MS)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    PrinterPool.statusObserver = null
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (e: RuntimeException) {
      // Already released.
    }
    wakeLock = null
    // Session 3D: stopped while the page still wants this device to print (its task swiped away, its screen destroyed).
    if (running && HostLife.noticeOnStop(Prefs.printing(this))) PrintingOffNotice.post(this)
    super.onDestroy()
  }

  private fun foregroundType(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      } else {
        NO_FOREGROUND_TYPE
      }

  private fun renewWakeLock() {
    val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    val lock = wakeLock ?: power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    lock.setReferenceCounted(false)
    wakeLock = lock
    lock.acquire(WAKE_LOCK_TIMEOUT_MS)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    val channel =
        NotificationChannel(
            CHANNEL_ID,
            getString(R.string.print_host_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
    manager.createNotificationChannel(channel)
    val alert =
        NotificationChannel(
            ALERT_CHANNEL_ID,
            getString(R.string.print_host_alert_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        )
    manager.createNotificationChannel(alert)
  }

  /** Phase 2 Session 2F2 (spec §9.2): the worst state across the app's printers ([HostTitle]); one printer reads as
   *  it always did. */
  private fun title(): String =
      when (val worst = HostTitle.of(PrinterPool.poolStatus())) {
        is HostTitle.PaperOut -> getString(R.string.print_host_title_paper_out, worst.name)
        HostTitle.NotConnected -> getString(R.string.print_host_title_no_printer)
        is HostTitle.Printer -> getString(R.string.print_host_title_printer, worst.name)
        is HostTitle.AllConnected -> getString(R.string.print_host_title_printers, worst.count)
        is HostTitle.OneDown -> getString(R.string.print_host_title_printer_down, worst.name)
        is HostTitle.SomeDown -> getString(R.string.print_host_title_printers_down, worst.count)
      }

  private fun text(): String =
      getString(
          R.string.print_host_text,
          label.ifBlank { getString(R.string.print_host_default_label) },
      )

  private fun buildNotification(): Notification {
    val alert = alerting()
    val builder =
        NotificationCompat.Builder(this, if (alert) ALERT_CHANNEL_ID else CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_printer)
            .setOngoing(true)
    if (alert) {
      builder
          .setContentTitle(getString(R.string.print_host_alert_title))
          .setContentText(getString(R.string.print_host_alert_text))
          .setOnlyAlertOnce(false)
          .setCategory(NotificationCompat.CATEGORY_ERROR)
          .setPriority(NotificationCompat.PRIORITY_HIGH)
    } else {
      builder
          .setContentTitle(title())
          .setContentText(text())
          .setOnlyAlertOnce(true)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setPriority(NotificationCompat.PRIORITY_LOW)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch != null) {
      builder.setContentIntent(
          PendingIntent.getActivity(
              this,
              0,
              launch,
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          )
      )
    }
    return builder.build()
  }

  private fun canNotify(): Boolean {
    if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
  }

  /** Re-posts the notification only when its words changed. */
  private fun refreshNotification() {
    if (!canNotify()) return
    val key = if (alerting()) ALERT_KEY else title() + "|" + text()
    if (key == shownKey) return
    try {
      NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
      shownKey = key
    } catch (e: SecurityException) {
      // Notification permission revoked: the service keeps running silently.
    }
  }
}
