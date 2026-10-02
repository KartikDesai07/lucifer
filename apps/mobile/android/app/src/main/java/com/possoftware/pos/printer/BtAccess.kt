package com.possoftware.pos.printer

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

/** Bluetooth adapter + runtime-permission checks shared by every Bluetooth call site. */
object BtAccess {
  fun adapter(ctx: Context): BluetoothAdapter? {
    val manager = ctx.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE)
    return (manager as? BluetoothManager)?.adapter
  }

  private fun granted(ctx: Context, permission: String): Boolean =
      ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

  /** API 31+ needs BLUETOOTH_CONNECT at runtime; older releases grant it at install time. */
  fun hasConnect(ctx: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
          granted(ctx, Manifest.permission.BLUETOOTH_CONNECT)

  /** Scanning: BLUETOOTH_SCAN on API 31+, ACCESS_FINE_LOCATION before that. */
  fun hasScan(ctx: Context): Boolean =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        granted(ctx, Manifest.permission.BLUETOOTH_SCAN)
      } else {
        granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
      }

  /**
   * Up to Android 11 the stack returns no scan results while system Location is off (the scan
   * permission there is ACCESS_FINE_LOCATION); Android 12+ scans never depend on Location.
   */
  fun locationOff(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) return false
    val manager = ctx.applicationContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    return manager != null && !LocationManagerCompat.isLocationEnabled(manager)
  }

  /** The bluetooth member of PrinterStatus. */
  fun state(ctx: Context): String {
    val adapter = adapter(ctx) ?: return BridgeCodes.BT_UNSUPPORTED
    if (!hasConnect(ctx)) return BridgeCodes.BT_UNAUTHORIZED
    return try {
      if (adapter.isEnabled) BridgeCodes.BT_ON else BridgeCodes.BT_OFF
    } catch (e: SecurityException) {
      BridgeCodes.BT_UNAUTHORIZED
    }
  }
}
