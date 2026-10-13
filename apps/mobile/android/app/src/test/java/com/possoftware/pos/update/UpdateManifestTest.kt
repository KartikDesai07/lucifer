package com.possoftware.pos.update

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Native apps 2.0 (spec §4): every rule of the update manifest. Each rejection is checked by its own reason, so a test
 * proves the rule it names fired, not an earlier one.
 */
class UpdateManifestTest {
  private val pkg = "com.possoftware.pos"
  private val phone = listOf("arm64-v8a", "armeabi-v7a")
  private val sha = "ab".repeat(32)

  /** A valid 2.1.0 manifest; [edit] changes it before it is written out. */
  private fun manifest(edit: (JSONObject) -> Unit = {}): String {
    val root = JSONObject()
        .put("schema", 1)
        .put("package", pkg)
        .put("version", "2.1.0")
        .put("versionCode", 20100)
        .put("released", "2026-11-02")
        .put("notes", "Faster printing.")
        .put("apks", JSONObject()
            .put("arm64-v8a", apk("Sandbee-POS-2.1.0-arm64-v8a.apk", 7_320_758))
            .put("armeabi-v7a", apk("Sandbee-POS-2.1.0-armeabi-v7a.apk", 6_728_592)))
    edit(root)
    return root.toString()
  }

  private fun apk(file: String, size: Int): JSONObject = JSONObject().put("file", file).put("sha256", sha).put("size", size)

  private fun apkOf(root: JSONObject, abi: String = "arm64-v8a"): JSONObject = root.getJSONObject("apks").getJSONObject(abi)

  private fun read(json: String, installed: Int = 20000, abis: List<String> = phone) =
      UpdateManifest.read(json, pkg, installed, abis)

  private fun offer(json: String, installed: Int = 20000, abis: List<String> = phone): UpdateManifest.Offer {
    val result = read(json, installed, abis)
    if (result !is UpdateManifest.Accepted) throw AssertionError("expected an offer, got $result")
    return result.offer
  }

  private fun ignored(reason: String, json: String, installed: Int = 20000, abis: List<String> = phone) =
      assertEquals(UpdateManifest.Ignored(reason), read(json, installed, abis))

  @Test
  fun aNewerManifestOffersTheApkForTheDevicesPreferredCpuType() {
    assertEquals(
        UpdateManifest.Offer("2.1.0", 20100, "Faster printing.", "arm64-v8a", "Sandbee-POS-2.1.0-arm64-v8a.apk", sha, 7_320_758),
        offer(manifest()))
    assertEquals("a 32-bit phone gets its own APK", "armeabi-v7a", offer(manifest(), abis = listOf("armeabi-v7a")).abi)
  }

  @Test
  fun theSameOrAnOlderVersionIsNeverOffered() {
    ignored("not newer", manifest(), installed = 20100)
    ignored("not newer", manifest(), installed = 20200)
    assertEquals(20100, offer(manifest(), installed = 20099).versionCode)
  }

  @Test
  fun everyTopLevelFieldIsChecked() {
    ignored("schema", manifest { it.remove("schema") })
    ignored("schema", manifest { it.put("schema", 2) })
    ignored("schema", manifest { it.put("schema", "1") })
    ignored("package", manifest { it.put("package", "com.example.other") })
    ignored("version", manifest { it.remove("version") })
    ignored("version", manifest { it.put("version", "2.1") })
    ignored("version", manifest { it.put("version", "2.100.0") })
    ignored("version", manifest { it.put("version", "2.1.1") }) // the versionCode says 2.1.0
    ignored("versionCode", manifest { it.put("versionCode", "20100") })
    ignored("versionCode", manifest { it.put("versionCode", 20100.5) })
    ignored("versionCode", manifest().replace("\"versionCode\":20100", "\"versionCode\":20100.0"))
    ignored("released", manifest { it.remove("released") })
    ignored("released", manifest { it.put("released", "02/11/2026") })
    ignored("apks", manifest { it.remove("apks") })
    ignored("apks", manifest { it.put("apks", "Sandbee-POS-2.1.0-arm64-v8a.apk") })
  }

  @Test
  fun anApkFileIsAPlainNameNeverAPathOrAnAddress() {
    val bad = listOf("../Sandbee.apk", "a/b.apk", "a\\b.apk", "https://evil.example/x.apk", "x.apk.exe", ".apk", "-x.apk",
        "x..apk", "", "x".repeat(100) + ".apk")
    for (file in bad) ignored("file arm64-v8a", manifest { apkOf(it).put("file", file) })
    ignored("file arm64-v8a", manifest { apkOf(it).remove("file") })
  }

  @Test
  fun hashAndSizeRules() {
    ignored("sha256 arm64-v8a", manifest { apkOf(it).put("sha256", "ab".repeat(31) + "a") })
    ignored("sha256 arm64-v8a", manifest { apkOf(it).put("sha256", "zz".repeat(32)) })
    ignored("sha256 arm64-v8a", manifest { apkOf(it).remove("sha256") })
    assertEquals("an upper-case hash is read in lower case", sha, offer(manifest { apkOf(it).put("sha256", sha.uppercase()) }).sha256)
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", 0) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", -1) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", UpdateManifest.MAX_APK_BYTES + 1) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", "7320758") })
    assertEquals("100 MB is allowed", UpdateManifest.MAX_APK_BYTES,
        offer(manifest { apkOf(it).put("size", UpdateManifest.MAX_APK_BYTES) }).size)
  }

  @Test
  fun notesAreOptionalAndShort() {
    assertEquals("", offer(manifest { it.remove("notes") }).notes)
    assertEquals("x".repeat(300), offer(manifest { it.put("notes", "x".repeat(300)) }).notes)
    ignored("notes", manifest { it.put("notes", "x".repeat(301)) })
    ignored("notes", manifest { it.put("notes", 5) })
  }

  @Test
  fun aDeviceWithoutAnApkForItsCpuTypeIsNotOffered() {
    ignored("no APK for this device", manifest(), abis = listOf("x86_64"))
    assertEquals("an emulator test build's own APK", "x86_64",
        offer(manifest { it.getJSONObject("apks").put("x86_64", apk("Sandbee-POS-2.1.0-x86_64.apk", 7_000_000)) },
            abis = listOf("x86_64", "arm64-v8a")).abi)
    assertEquals("a CPU type the app never ships for is not judged", "arm64-v8a",
        offer(manifest { it.getJSONObject("apks").put("mips", "anything") }).abi)
  }

  @Test
  fun anythingThatIsNotAManifestIsIgnored() {
    ignored("not JSON", "")
    ignored("not JSON", "<html>Not found</html>")
    ignored("not JSON", "[1, 2]")
    ignored("too large", " ".repeat(UpdateManifest.MAX_JSON_CHARS + 1))
  }

  @Test
  fun aVersionCodeIsMajorMinorPatch() {
    assertEquals(20000, UpdateManifest.codeOf("2.0.0"))
    assertEquals(20100, UpdateManifest.codeOf("2.1.0"))
    assertEquals(109999, UpdateManifest.codeOf("10.99.99"))
    assertNull(UpdateManifest.codeOf("2.100.0"))
    assertNull(UpdateManifest.codeOf("2.0"))
    assertNull(UpdateManifest.codeOf("v2.0.0"))
  }

  // The N1 review gate (native apps 2.0, Session N2 Task 0): the review's m-3, m-4 and m-5.

  @Test
  fun aByteOrderMarkBeforeTheManifestIsRead() {
    // m-5: a file re-saved by an editor that writes a UTF-8 byte order mark is still the manifest.
    assertEquals(20100, offer("\uFEFF" + manifest()).versionCode)
  }

  @Test
  fun aNullNoteIsNoNote() {
    // m-4: notes are optional, and null says "none" as a missing field does.
    assertEquals("", offer(manifest { it.put("notes", JSONObject.NULL) }).notes)
  }

  @Test
  fun aFileNestedTooDeepIsIgnoredNeverACrash() {
    // m-3: the parser goes one call deeper per bracket, so a small file nested deep enough overflows the stack, an Error
    // (not a JSONException) that would end the updater's thread.
    ignored("not JSON", "{\"a\":" + "[".repeat(UpdateManifest.MAX_JSON_CHARS - 10))
  }
}
