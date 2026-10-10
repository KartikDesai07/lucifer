package com.possoftware.pos.printer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Phase 3 Session 3D (spec §9.5): after a reboot (BOOT_COMPLETED) or an update of the app (MY_PACKAGE_REPLACED) nothing
 * prints until the app is opened, so a device that printed for the cafe before says "POS printing is off. Tap to start."
 * It never starts the app (Android blocks that from the background) and makes no request.
 */
class PrintingOffReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (HostLife.noticeOnBroadcast(intent.action, Prefs.printing(context))) PrintingOffNotice.post(context)
  }
}
