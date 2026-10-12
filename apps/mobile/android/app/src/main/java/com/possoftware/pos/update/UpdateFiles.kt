package com.possoftware.pos.update

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Locale

/**
 * Native apps 2.0 (spec §4, §6.2): the updater's pure file rules. The manifest and every APK are under
 * `<base>/android/`, never at an address the manifest names; a kept download is stale once the app is that version, or
 * its file is gone; and a download is kept only when exactly the manifest's size came with the manifest's SHA-256.
 * Pure, so the JVM tests (src/test) pin each rule.
 */
object UpdateFiles {
  private const val BUFFER_BYTES = 64 * 1024
  private const val BYTE_MASK = 0xFF

  fun manifestUrl(base: String): String = base.trimEnd('/') + "/android/latest.json"

  /** [file] already passed [UpdateManifest]'s plain-name rule. */
  fun apkUrl(base: String, file: String): String = base.trimEnd('/') + "/android/" + file

  /** spec §6.2.6: a kept download goes at start-up once the app is that version (or newer), or once its file is gone.
   *  Nothing kept: nothing to do. */
  fun staleAfterUpdate(storedCode: Int?, installedCode: Int, fileExists: Boolean): Boolean =
      storedCode != null && (storedCode <= installedCode || !fileExists)

  /**
   * Copies [input] to [out] and reads at most [size] + 1 bytes: true only when exactly [size] bytes came and their
   * SHA-256 (lower-case hex) is [sha256]. A dropped connection (fewer), a longer file or an error page is false; the
   * caller then deletes what was written.
   */
  fun copyVerified(input: InputStream, out: OutputStream, size: Int, sha256: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    val limit = size.toLong() + 1
    var total = 0L
    while (total < limit) {
      val read = input.read(buffer, 0, minOf(buffer.size.toLong(), limit - total).toInt())
      if (read < 0) break
      total += read
      if (total > size) return false
      digest.update(buffer, 0, read)
      out.write(buffer, 0, read)
    }
    return total == size.toLong() && hex(digest.digest()) == sha256
  }

  private fun hex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) out.append(String.format(Locale.ROOT, "%02x", b.toInt() and BYTE_MASK))
    return out.toString()
  }
}
