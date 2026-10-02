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
 */
class PrintHostService : Service() {

  companion object {
    const val ACTION_START = "com.possoftware.pos.printer.action.START_HOST"
    const val EXTRA_LABEL = "label"
    const val CHANNEL_ID = "print_host"
    const val ALERT_CHANNEL_ID = "print_host_alert"
    const val NOTIFICATION_ID = 4101
    const val APP_WAKE_TICK_MS = 15_000L
    const val WAKE_LOCK_TIMEOUT_MS = 60_000L

    /** Consecutive ticks with an unanswered or wrong page probe before the alert replaces the notification. */
    const val PAGE_DEAD_TICKS = 2
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

  // Page liveness (main thread only): each tick scores the previous tick's probe, then sends one.
  private var probeSeq = 0
  private var probeIssued = false
  private var probeAnswered = false
  private var deadTicks = 0

  private val tick =
      object : Runnable {
        override fun run() {
          renewWakeLock()
          if (!PrinterManager.appVisible) {
            WebViewDelivery.deliverEvent(BridgeCodes.EVENT_APP_WAKE, JSONObject())
          }
          probePage()
          refreshNotification()
          handler.postDelayed(this, APP_WAKE_TICK_MS)
        }
      }

  private fun probePage() {
    if (probeIssued) deadTicks = if (probeAnswered) 0 else deadTicks + 1
    probeAnswered = false
    probeIssued = true
    val id = ++probeSeq
    // A late answer to an older probe must not vouch for this one.
    WebViewDelivery.probePage { alive -> if (alive && id == probeSeq) probeAnswered = true }
  }

  /** The page has stopped answering and nobody is looking at the app, so only a notification can say so. */
  private fun alerting(): Boolean = deadTicks >= PAGE_DEAD_TICKS && !PrinterManager.appVisible

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
    PrinterManager.statusObserver = { handler.post { refreshNotification() } }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
    probeIssued = false
    deadTicks = 0
    renewWakeLock()
    handler.removeCallbacks(tick)
    handler.postDelayed(tick, APP_WAKE_TICK_MS)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    PrinterManager.statusObserver = null
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (e: RuntimeException) {
      // Already released.
    }
    wakeLock = null
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

  private fun title(snapshot: StatusSnapshot): String {
    val printer = snapshot.printer
    return if (snapshot.state == BridgeCodes.STATE_CONNECTED && printer != null) {
      getString(R.string.print_host_title_printer, printer.name)
    } else {
      getString(R.string.print_host_title_no_printer)
    }
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
          .setContentTitle(title(PrinterManager.status()))
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
    val key = if (alerting()) ALERT_KEY else title(PrinterManager.status()) + "|" + text()
    if (key == shownKey) return
    try {
      NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
      shownKey = key
    } catch (e: SecurityException) {
      // Notification permission revoked: the service keeps running silently.
    }
  }
}
