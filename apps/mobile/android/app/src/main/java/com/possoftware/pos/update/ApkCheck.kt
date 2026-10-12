package com.possoftware.pos.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File

/**
 * Native apps 2.0 (spec §3, §6.1): a downloaded APK reaches the card only when it is this app (its package), the
 * manifest's version (its versionCode) and signed by the installed app's own key. Android would refuse an update signed
 * by another key anyway, but only after the user tapped Install; this check keeps such a file from ever being offered.
 */
object ApkCheck {
  fun matches(ctx: Context, apk: File, offer: UpdateManifest.Offer): Boolean {
    val pm = ctx.packageManager
    val archive = pm.getPackageArchiveInfo(apk.path, archiveFlags()) ?: return false
    if (archive.packageName != ctx.packageName) return false
    if (PackageInfoCompat.getLongVersionCode(archive) != offer.versionCode.toLong()) return false
    val installed =
        try {
          pm.getPackageInfo(ctx.packageName, signingFlags())
        } catch (e: PackageManager.NameNotFoundException) {
          return false
        }
    val theirs = signers(archive)
    val ours = signers(installed)
    return theirs.isNotEmpty() && theirs == ours
  }

  @Suppress("DEPRECATION") // GET_SIGNATURES is the only way below API 28
  private fun signingFlags(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
      else PackageManager.GET_SIGNATURES

  /** A downloaded APK: Android 9 reads an archive's certificates only when GET_SIGNATURES is asked for (Android 10 and
   *  later for either flag), so both are (the N1 review gate, the N2 review's I-1). */
  @Suppress("DEPRECATION")
  private fun archiveFlags(): Int = signingFlags() or PackageManager.GET_SIGNATURES

  /** The certificates the APK's contents are signed with now (not the past ones of a key rotation); the older field
   *  when the signing info is missing. */
  @Suppress("DEPRECATION") // PackageInfo.signatures is the only way below API 28
  private fun signers(info: PackageInfo): Set<String> {
    val certs: Array<Signature>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners ?: info.signatures
        else info.signatures
    return certs?.map { it.toCharsString() }?.toSet() ?: emptySet()
  }
}
