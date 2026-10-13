package com.possoftware.pos.update

import org.json.JSONException
import org.json.JSONObject

/**
 * Native apps 2.0 (spec §4): the update manifest, `<base>/android/latest.json`, read against the installed app. It is
 * accepted only when every rule holds; anything else is ignored silently (the app stays as it is and looks again at a
 * later app open). The APK's address never comes from the manifest: [Offer.file] is a plain file name the updater puts
 * after `<base>/android/`. Pure, so the JVM tests (src/test) pin every rule.
 */
object UpdateManifest {
  const val SCHEMA = 1
  const val MAX_APK_BYTES = 100 * 1024 * 1024
  const val MAX_NOTES_CHARS = 300
  /** A manifest is a few hundred bytes; anything far larger is not one. */
  const val MAX_JSON_CHARS = 16 * 1024

  /** The CPU types an APK may be named for (the release ships the first two; an emulator test build adds x86_64). */
  val ABIS = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")

  private val VERSION = Regex("""(\d{1,3})\.(\d{1,2})\.(\d{1,2})""")
  private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")
  private val FILE = Regex("""[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk""")
  private val SHA256 = Regex("""[0-9a-fA-F]{64}""")

  /** A UTF-8 byte order mark an editor may write before the text (the N1 review gate, m-5). */
  private const val BOM = "\uFEFF"

  /** The newer release this device can install: the APK for its preferred CPU type. */
  data class Offer(
      val version: String,
      val versionCode: Int,
      val notes: String,
      val abi: String,
      val file: String,
      val sha256: String,
      val size: Int,
  )

  sealed interface Result

  data class Accepted(val offer: Offer) : Result

  data class Ignored(val reason: String) : Result

  /** spec §5: versionCode = major × 10000 + minor × 100 + patch; null when [version] is not x.y.z with minor and patch
   *  below 100. */
  fun codeOf(version: String): Int? {
    val match = VERSION.matchEntire(version) ?: return null
    val (major, minor, patch) = match.destructured
    return major.toInt() * 10_000 + minor.toInt() * 100 + patch.toInt()
  }

  /** [deviceAbis]: Build.SUPPORTED_ABIS, the device's preferred CPU type first. */
  fun read(json: String, packageName: String, installedCode: Int, deviceAbis: List<String>): Result {
    if (json.length > MAX_JSON_CHARS) return Ignored("too large")
    val root = try {
      JSONObject(json.removePrefix(BOM))
    } catch (e: JSONException) {
      return Ignored("not JSON")
    } catch (e: StackOverflowError) {
      // The N1 review gate (m-3): the parser goes one call deeper per bracket; a file nested deep enough is not a
      // manifest, and must never end the updater's thread.
      return Ignored("not JSON")
    }
    if (root.opt("schema") != SCHEMA) return Ignored("schema")
    if (root.opt("package") != packageName) return Ignored("package")
    val version = root.opt("version") as? String ?: return Ignored("version")
    val code = root.opt("versionCode") as? Int ?: return Ignored("versionCode")
    if (codeOf(version) != code) return Ignored("version")
    if (code <= installedCode) return Ignored("not newer")
    val released = root.opt("released") as? String
    if (released == null || !DATE.matches(released)) return Ignored("released")
    val notes = when (val n = root.opt("notes")) {
      // The N1 review gate (m-4): null says "no notes", as a missing field does.
      null, JSONObject.NULL -> ""
      is String -> if (n.length <= MAX_NOTES_CHARS) n.trim() else return Ignored("notes")
      else -> return Ignored("notes")
    }
    val apks = root.opt("apks") as? JSONObject ?: return Ignored("apks")
    val offers = HashMap<String, Offer>()
    for (abi in apks.keys()) {
      if (abi !in ABIS) continue
      val apk = apks.opt(abi) as? JSONObject ?: return Ignored("apk $abi")
      val file = apk.opt("file") as? String
      if (file == null || !FILE.matches(file) || file.contains("..")) return Ignored("file $abi")
      val sha256 = apk.opt("sha256") as? String
      if (sha256 == null || !SHA256.matches(sha256)) return Ignored("sha256 $abi")
      val size = apk.opt("size") as? Int
      if (size == null || size <= 0 || size > MAX_APK_BYTES) return Ignored("size $abi")
      offers[abi] = Offer(version, code, notes, abi, file, sha256.lowercase(), size)
    }
    val abi = deviceAbis.firstOrNull { it in offers } ?: return Ignored("no APK for this device")
    return Accepted(offers.getValue(abi))
  }
}
