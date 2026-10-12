package com.possoftware.pos.update

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native apps 2.0 (spec §6.1, §6.2): the updater's two requests, made on its own background thread ([PosUpdateModule];
 * never the main thread, never a printer's): `<base>/android/latest.json`, and the APK it names, streamed into
 * `filesDir/updates/<file>.part` and renamed only when its size and SHA-256 are the manifest's ([UpdateFiles]), then
 * kept only when [ApkCheck] agrees. Any failure leaves nothing behind; the next check tries again.
 */
object UpdateDownloader {
  const val TAG = "PosUpdate"
  private const val TIMEOUT_MS = 10_000
  private const val PART = ".part"

  /** The manifest request's answer: its HTTP status, and for a 200 its text (at most one character past a manifest's
   *  limit, so [UpdateManifest] can say "too large"). */
  data class Fetched(val status: Int, val body: String?)

  /** GET `<base>/android/latest.json`; null when no HTTP answer came (no network, a timeout, a refused connection). */
  fun fetchManifest(base: String): Fetched? {
    var conn: HttpURLConnection? = null
    return try {
      conn = URL(UpdateFiles.manifestUrl(base)).openConnection() as HttpURLConnection
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      conn.useCaches = false
      conn.setRequestProperty("Accept", "application/json")
      val status = conn.responseCode
      Fetched(status, if (status == HttpURLConnection.HTTP_OK) readCapped(conn) else null)
    } catch (e: IOException) {
      null
    } finally {
      conn?.disconnect()
    }
  }

  private fun readCapped(conn: HttpURLConnection): String {
    InputStreamReader(conn.inputStream, Charsets.UTF_8).use { reader ->
      val buffer = CharArray(UpdateManifest.MAX_JSON_CHARS + 1)
      var total = 0
      while (total < buffer.size) {
        val read = reader.read(buffer, total, buffer.size - total)
        if (read < 0) break
        total += read
      }
      return String(buffer, 0, total)
    }
  }

  /** Downloads [offer]'s APK into `updates/` and returns it once verified; null (nothing left behind) otherwise. */
  fun download(ctx: Context, base: String, offer: UpdateManifest.Offer): File? {
    val dir = UpdateStore.updatesDir(ctx)
    if (!dir.isDirectory && !dir.mkdirs()) return null
    UpdateStore.deleteFilesExcept(ctx, null)
    val part = File(dir, offer.file + PART)
    val apk = File(dir, offer.file)
    var conn: HttpURLConnection? = null
    try {
      conn = URL(UpdateFiles.apkUrl(base, offer.file)).openConnection() as HttpURLConnection
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      conn.useCaches = false
      val status = conn.responseCode
      if (status != HttpURLConnection.HTTP_OK) return failed(part, apk, "download: HTTP $status")
      val copied =
          conn.inputStream.use { input ->
            FileOutputStream(part).use { out -> UpdateFiles.copyVerified(input, out, offer.size, offer.sha256) }
          }
      if (!copied) return failed(part, apk, "download: the size or SHA-256 is not the manifest's")
      if (!part.renameTo(apk)) return failed(part, apk, "download: could not keep the file")
      if (!ApkCheck.matches(ctx, apk, offer)) return failed(part, apk, "download: the package, version or signer is not this app's")
      Log.i(TAG, "download: " + offer.version + " verified (" + offer.size + " bytes)")
      return apk
    } catch (e: IOException) {
      return failed(part, apk, "download: " + e.javaClass.simpleName)
    } finally {
      conn?.disconnect()
    }
  }

  private fun failed(part: File, apk: File, why: String): File? {
    part.delete()
    apk.delete()
    Log.i(TAG, why)
    return null
  }
}
