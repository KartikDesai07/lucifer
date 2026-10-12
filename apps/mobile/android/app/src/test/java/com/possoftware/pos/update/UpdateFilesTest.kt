package com.possoftware.pos.update

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Native apps 2.0 (spec §4, §6.2): where the updater looks, when a kept download is stale, and the one copy that decides
 * whether a download is the manifest's APK: exactly its size, then its SHA-256. A dropped connection, a longer file or a
 * CDN's error page is never kept.
 */
class UpdateFilesTest {
  private val apk = ByteArray(200_000) { (it * 31 + 7).toByte() }
  private val sha = sha256(apk)

  private fun sha256(bytes: ByteArray): String =
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  /** Counts the bytes handed out, to prove the copy never reads far past the expected size. */
  private class Counting(bytes: ByteArray) : InputStream() {
    private val inner = ByteArrayInputStream(bytes)
    var count = 0
      private set

    override fun read(): Int = inner.read().also { if (it >= 0) count++ }

    override fun read(b: ByteArray, off: Int, len: Int): Int = inner.read(b, off, len).also { if (it > 0) count += it }
  }

  @Test
  fun theManifestAndAnApkAreAlwaysUnderTheBase() {
    assertEquals("https://files.sandbee.in/pos/android/latest.json", UpdateFiles.manifestUrl("https://files.sandbee.in/pos"))
    assertEquals("https://files.sandbee.in/pos/android/latest.json", UpdateFiles.manifestUrl("https://files.sandbee.in/pos/"))
    assertEquals(
        "http://127.0.0.1:8765/pos/android/Sandbee-POS-2.0.1-x86_64.apk",
        UpdateFiles.apkUrl("http://127.0.0.1:8765/pos", "Sandbee-POS-2.0.1-x86_64.apk"))
  }

  @Test
  fun aKeptDownloadIsStaleOnceTheAppIsThatVersionOrItsFileIsGone() {
    assertTrue("updated to it", UpdateFiles.staleAfterUpdate(20001, 20001, true))
    assertTrue("updated past it", UpdateFiles.staleAfterUpdate(20001, 20100, true))
    assertTrue("its file is gone", UpdateFiles.staleAfterUpdate(20100, 20001, false))
    assertFalse("newer and there: kept for the next open", UpdateFiles.staleAfterUpdate(20100, 20001, true))
    assertFalse("nothing kept: nothing to do", UpdateFiles.staleAfterUpdate(null, 20001, false))
  }

  @Test
  fun theManifestsBytesAreKept() {
    val out = ByteArrayOutputStream()
    assertTrue(UpdateFiles.copyVerified(ByteArrayInputStream(apk), out, apk.size, sha))
    assertArrayEquals(apk, out.toByteArray())
  }

  @Test
  fun oneByteChangedIsRefused() {
    val changed = apk.copyOf().also { it[123_456] = (it[123_456] + 1).toByte() }
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(changed), ByteArrayOutputStream(), apk.size, sha))
  }

  @Test
  fun aDroppedConnectionIsRefused() {
    val short = apk.copyOf(apk.size - 1)
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(short), ByteArrayOutputStream(), apk.size, sha))
  }

  @Test
  fun aLongerFileIsRefusedAfterOneByteMore() {
    val input = Counting(apk + ByteArray(50_000))
    assertFalse(UpdateFiles.copyVerified(input, ByteArrayOutputStream(), apk.size, sha))
    assertTrue("read at most size + 1 bytes, read " + input.count, input.count <= apk.size + 1)
  }

  @Test
  fun anErrorPageInsteadOfTheApkIsRefused() {
    val page = "<html><body>404 Not Found</body></html>".toByteArray()
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(page), ByteArrayOutputStream(), apk.size, sha))
  }
}
