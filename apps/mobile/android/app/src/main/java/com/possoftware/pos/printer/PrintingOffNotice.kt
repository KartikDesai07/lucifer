package com.possoftware.pos.printer

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.possoftware.pos.R

/**
 * Phase 3 Session 3D (spec §9.5): "POS printing is off. Tap to start." on a device that prints for the cafe once its page
 * is gone without the page saying stop ([HostLife]): Android restarted the print host service after its process died, the
 * phone restarted, the app was updated, or its task was swiped away. A tap opens the app, whose page then prints again by
 * itself. It is on the alert channel (it may sound), can be swiped away, and goes when printing is on again.
 */
object PrintingOffNotice {
  const val NOTIFICATION_ID = 4102

  fun post(ctx: Context) {
    val app = ctx.applicationContext
    if (!canNotify(app)) return
    ensureChannel(app)
    val builder =
        NotificationCompat.Builder(app, PrintHostService.ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_printer)
            .setContentTitle(app.getString(R.string.printing_off_title))
            .setContentText(app.getString(R.string.printing_off_text))
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
    val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)
    if (launch != null) {
      builder.setContentIntent(
          PendingIntent.getActivity(app, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
    }
    try {
      NotificationManagerCompat.from(app).notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      // Notifications not allowed: nothing to show.
    }
  }

  fun cancel(ctx: Context) {
    NotificationManagerCompat.from(ctx.applicationContext).cancel(NOTIFICATION_ID)
  }

  private fun canNotify(ctx: Context): Boolean {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  }

  /** The print host's alert channel; after a reboot this can run before the service ever made it. */
  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    manager.createNotificationChannel(
        NotificationChannel(
            PrintHostService.ALERT_CHANNEL_ID,
            ctx.getString(R.string.print_host_alert_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        )
    )
  }
}
