package com.possoftware.pos.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log

/**
 * Native apps 2.0 (spec §6.2): Android's answer to the install the card started. Not exported: only the installer's
 * PendingIntent ([UpdateInstaller]) reaches it. "The user must confirm" opens Android's own install dialog; success
 * needs nothing (the update is replacing this app); a failure, or Cancel in that dialog, tells the card ([onFailed]) and
 * keeps the file, so the next app open offers the card again.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
  companion object {
    /** Set by [PosUpdateModule] while React runs. */
    @Volatile var onFailed: (() -> Unit)? = null
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = confirmIntent(intent)
        if (confirm == null) {
          failed("install: no confirm screen")
          return
        }
        try {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: RuntimeException) {
          failed("install: the confirm screen did not open")
        }
      }
      PackageInstaller.STATUS_SUCCESS -> Log.i(UpdateDownloader.TAG, "install: done")
      else -> failed("install: status $status")
    }
  }

  private fun failed(why: String) {
    Log.i(UpdateDownloader.TAG, why)
    onFailed?.invoke()
  }

  @Suppress("DEPRECATION") // the typed overload exists from API 33
  private fun confirmIntent(intent: Intent): Intent? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      } else {
        intent.getParcelableExtra(Intent.EXTRA_INTENT)
      }
}
