package com.possoftware.pos.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.FileInputStream
import java.io.IOException

/**
 * Native apps 2.0 (spec §6.1, §6.2, §6.4): installs the verified update, only ever from a tap on the card's Install
 * ([PosUpdateModule.install]). The first time, Android must let this app install apps, so its "Install unknown apps"
 * page opens; then a PackageInstaller session hands the file to Android, whose own dialog asks once more
 * ([UpdateInstallReceiver] shows it). The update ends the running app, as every app update does.
 */
object UpdateInstaller {
  /** What a tap on Install started; [answer] is what the card hears. */
  enum class InstallStart(val answer: String) {
    STARTED("started"),
    NEEDS_PERMISSION("permission"),
    MISSING("missing"),
    FAILED("failed"),
    /** Later (or Back) on the card while Install still waited for the printers: nothing started (the N2 review gate,
     *  the review's m-1). */
    CANCELLED("cancelled"),
  }

  private const val SESSION_FILE = "update.apk"
  private const val STATUS_REQUEST = 4104

  fun install(ctx: Context, apk: File): InstallStart {
    val app = ctx.applicationContext
    if (!apk.isFile) return InstallStart.MISSING
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !app.packageManager.canRequestPackageInstalls()) {
      val settings =
          Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      app.startActivity(settings)
      return InstallStart.NEEDS_PERMISSION
    }
    val installer = app.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(app.packageName)
    params.setSize(apk.length())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Always Android's own dialog, never an install without the user's tap there (spec D3).
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    // A session that cannot be written or committed is abandoned, never left open: an IOException, or a RuntimeException
    // such as SecurityException (the N2 review gate, the review's m-5).
    val id = installer.createSession(params)
    return try {
      installer.openSession(id).use { session ->
        FileInputStream(apk).use { input ->
          session.openWrite(SESSION_FILE, 0, apk.length()).use { out ->
            input.copyTo(out)
            session.fsync(out)
          }
        }
        session.commit(statusIntent(app).intentSender)
      }
      InstallStart.STARTED
    } catch (e: IOException) {
      installer.abandonSession(id)
      InstallStart.FAILED
    } catch (e: RuntimeException) {
      installer.abandonSession(id)
      InstallStart.FAILED
    }
  }

  /** The installer adds its answer to this intent, so it is mutable on Android 12+; it names this app's own receiver,
   *  as Android 14 requires of a mutable PendingIntent. */
  private fun statusIntent(app: Context): PendingIntent {
    val intent = Intent(app, UpdateInstallReceiver::class.java)
    val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    return PendingIntent.getBroadcast(app, STATUS_REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
  }
}
