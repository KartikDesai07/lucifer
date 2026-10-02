package com.possoftware.pos.printer

import android.content.Context
import android.content.SharedPreferences

/** The only persisted state: the POS address, the chosen printer and the one-time battery prompt flag. */
object Prefs {
  private const val FILE = "pos_software_prefs"
  private const val KEY_ORIGIN = "posOrigin"
  private const val KEY_PRINTER_ID = "printerId"
  private const val KEY_PRINTER_NAME = "printerName"
  private const val KEY_PRINTER_TRANSPORT = "printerTransport"
  private const val KEY_PRINTER_ADDRESS = "printerAddress"
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

  fun savedPrinter(ctx: Context): PrinterInfo? {
    val p = prefs(ctx)
    val id = p.getString(KEY_PRINTER_ID, null) ?: return null
    val name = p.getString(KEY_PRINTER_NAME, null) ?: return null
    val transport = p.getString(KEY_PRINTER_TRANSPORT, null) ?: return null
    return PrinterInfo(id, name, transport, p.getString(KEY_PRINTER_ADDRESS, null))
  }

  fun savePrinter(ctx: Context, info: PrinterInfo) {
    prefs(ctx)
        .edit()
        .putString(KEY_PRINTER_ID, info.id)
        .putString(KEY_PRINTER_NAME, info.name)
        .putString(KEY_PRINTER_TRANSPORT, info.transport)
        .putString(KEY_PRINTER_ADDRESS, info.address)
        .apply()
  }

  fun clearPrinter(ctx: Context) {
    prefs(ctx)
        .edit()
        .remove(KEY_PRINTER_ID)
        .remove(KEY_PRINTER_NAME)
        .remove(KEY_PRINTER_TRANSPORT)
        .remove(KEY_PRINTER_ADDRESS)
        .apply()
  }

  fun batteryPrompted(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_BATTERY_PROMPTED, false)

  fun markBatteryPrompted(ctx: Context) {
    prefs(ctx).edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
  }
}
