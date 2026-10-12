package com.possoftware.pos.update

import android.content.Context
import java.io.File

/**
 * Native apps 2.0 (spec §6.1): the updater's own memory, in its own private preferences file (never the printer's
 * Prefs): when it last looked, and the update downloaded and verified so far, whose file is in `filesDir/updates/`.
 * Thread-safe (SharedPreferences); the rules are [UpdateFiles]'.
 */
object UpdateStore {
  private const val FILE = "pos_update"
  private const val DIR = "updates"
  private const val KEY_LAST_CHECK = "last_check_at"
  private const val KEY_CODE = "verified_code"
  private const val KEY_VERSION = "verified_version"
  private const val KEY_NOTES = "verified_notes"
  private const val KEY_FILE = "verified_file"
  private const val KEY_SHA256 = "verified_sha256"

  /** An update downloaded and checked (size, SHA-256, package, version, signer), waiting for an app open. */
  data class Verified(val versionCode: Int, val version: String, val notes: String, val file: String, val sha256: String)

  private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun updatesDir(ctx: Context): File = File(ctx.applicationContext.filesDir, DIR)

  /** Wall time of the last manifest request that got an HTTP answer; 0 when never. */
  fun lastCheckAt(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_CHECK, 0L)

  fun setLastCheckAt(ctx: Context, wallMs: Long) {
    prefs(ctx).edit().putLong(KEY_LAST_CHECK, wallMs).apply()
  }

  /** The verified update, or null unless every field is there and its file still is. */
  fun verified(ctx: Context): Verified? {
    val p = prefs(ctx)
    val code = p.getInt(KEY_CODE, 0)
    val version = p.getString(KEY_VERSION, null)
    val notes = p.getString(KEY_NOTES, null)
    val file = p.getString(KEY_FILE, null)
    val sha256 = p.getString(KEY_SHA256, null)
    if (code <= 0 || version == null || notes == null || file == null || sha256 == null) return null
    if (!File(updatesDir(ctx), file).isFile) return null
    return Verified(code, version, notes, file, sha256)
  }

  fun saveVerified(ctx: Context, v: Verified) {
    prefs(ctx)
        .edit()
        .putInt(KEY_CODE, v.versionCode)
        .putString(KEY_VERSION, v.version)
        .putString(KEY_NOTES, v.notes)
        .putString(KEY_FILE, v.file)
        .putString(KEY_SHA256, v.sha256)
        .apply()
  }

  fun clearVerified(ctx: Context) {
    prefs(ctx).edit().remove(KEY_CODE).remove(KEY_VERSION).remove(KEY_NOTES).remove(KEY_FILE).remove(KEY_SHA256).apply()
  }

  /** Deletes every file in `updates/` but [keep]. */
  fun deleteFilesExcept(ctx: Context, keep: String?) {
    updatesDir(ctx).listFiles()?.forEach { if (it.name != keep) it.delete() }
  }

  /**
   * spec §6.2.6, once per process: a kept update the app now is (or is past), or whose file is gone, goes with its
   * entry; anything else in `updates/` (a download cut short by the process ending) goes too.
   */
  fun startUp(ctx: Context, installedCode: Int) {
    val p = prefs(ctx)
    val code = if (p.contains(KEY_CODE)) p.getInt(KEY_CODE, 0) else null
    val file = p.getString(KEY_FILE, null)
    val exists = file != null && File(updatesDir(ctx), file).isFile
    if (UpdateFiles.staleAfterUpdate(code, installedCode, exists)) {
      clearVerified(ctx)
      deleteFilesExcept(ctx, null)
    } else {
      deleteFilesExcept(ctx, if (code != null) file else null)
    }
  }
}
