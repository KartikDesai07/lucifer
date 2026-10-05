package com.possoftware.pos.printer

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * The only persisted state: the POS address, the app's printers and the one-time battery prompt flag.
 *
 * Phase 2 Session 2F2 (spec §9.2): the printers are a list with a default ([KEY_PRINTERS], [KEY_PRINTER_DEFAULT]). The
 * v1 keys (the one printer of every app before it) always name the default printer: an app updated from v1 moves its
 * one printer into the list as the default, and an older app reinstalled over this one still finds this device's
 * printer ([PoolList.restore] follows any change it makes).
 */
object Prefs {
  private const val FILE = "pos_software_prefs"
  private const val KEY_ORIGIN = "posOrigin"
  private const val KEY_PRINTER_ID = "printerId"
  private const val KEY_PRINTER_NAME = "printerName"
  private const val KEY_PRINTER_TRANSPORT = "printerTransport"
  private const val KEY_PRINTER_ADDRESS = "printerAddress"
  private const val KEY_PRINTERS = "printers"
  private const val KEY_PRINTER_DEFAULT = "printerDefault"
  private const val KEY_BATTERY_PROMPTED = "batteryPrompted"

  private fun prefs(ctx: Context): SharedPreferences =
      ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun origin(ctx: Context): String? = prefs(ctx).getString(KEY_ORIGIN, null)

  fun saveOrigin(ctx: Context, origin: String) {
    prefs(ctx).edit().putString(KEY_ORIGIN, origin).apply()
  }

  fun clearOrigin(ctx: Context) {
    prefs(ctx).edit().remove(KEY_ORIGIN).apply()
  }

  /** The printer the v1 keys name (the default printer), or null. */
  private fun savedPrinter(ctx: Context): PrinterInfo? {
    val p = prefs(ctx)
    val id = p.getString(KEY_PRINTER_ID, null) ?: return null
    val name = p.getString(KEY_PRINTER_NAME, null) ?: return null
    val transport = p.getString(KEY_PRINTER_TRANSPORT, null) ?: return null
    return PrinterInfo(id, name, transport, p.getString(KEY_PRINTER_ADDRESS, null))
  }

  /** The app's printers as saved, the one v1 printer migrated into the list as the default. */
  fun savedPrinters(ctx: Context): PoolList<PrinterInfo> {
    val p = prefs(ctx)
    val listed = p.getString(KEY_PRINTERS, null)?.let { parsePrinters(it) }
    return PoolList.restore(listed, p.getString(KEY_PRINTER_DEFAULT, null), savedPrinter(ctx))
  }

  /** Saves the list and its default; the v1 keys name the default printer (or nothing, with no printer). */
  fun savePrinters(ctx: Context, printers: List<PrinterInfo>, defaultId: String?) {
    val array = JSONArray()
    for (info in printers) {
      val json = JSONObject().put("id", info.id).put("name", info.name).put("transport", info.transport)
      if (info.address != null) json.put("address", info.address)
      array.put(json)
    }
    val edit = prefs(ctx).edit().putString(KEY_PRINTERS, array.toString())
    val default = printers.firstOrNull { it.id == defaultId }
    if (default == null) {
      edit
          .remove(KEY_PRINTER_DEFAULT)
          .remove(KEY_PRINTER_ID)
          .remove(KEY_PRINTER_NAME)
          .remove(KEY_PRINTER_TRANSPORT)
          .remove(KEY_PRINTER_ADDRESS)
    } else {
      edit
          .putString(KEY_PRINTER_DEFAULT, default.id)
          .putString(KEY_PRINTER_ID, default.id)
          .putString(KEY_PRINTER_NAME, default.name)
          .putString(KEY_PRINTER_TRANSPORT, default.transport)
          .putString(KEY_PRINTER_ADDRESS, default.address)
    }
    edit.apply()
  }

  /** The saved list, or null when it cannot be read (then the v1 keys alone say this device's printer). */
  private fun parsePrinters(raw: String): List<PrinterInfo>? =
      try {
        val array = JSONArray(raw)
        val out = ArrayList<PrinterInfo>(array.length())
        for (i in 0 until array.length()) {
          val json = array.optJSONObject(i) ?: continue
          val id = json.optString("id", "")
          val name = json.optString("name", "")
          val transport = json.optString("transport", "")
          if (id.isEmpty() || name.isEmpty() || PrinterIds.transportOf(id) != transport) continue
          out.add(PrinterInfo(id, name, transport, if (json.has("address")) json.optString("address") else null))
        }
        out
      } catch (e: JSONException) {
        null
      }

  fun batteryPrompted(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_BATTERY_PROMPTED, false)

  fun markBatteryPrompted(ctx: Context) {
    prefs(ctx).edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
  }
}
