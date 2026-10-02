package com.possoftware.pos.printer

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil

/** The system "turn on Bluetooth?" dialog; the answer arrives through the activity result. */
class BluetoothEnabler(private val ctx: ReactApplicationContext) {
  companion object {
    const val REQUEST_ENABLE_BT = 4102
  }

  private val lock = Any()
  private var pending: Promise? = null

  val activityListener: BaseActivityEventListener =
      object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
          if (requestCode != REQUEST_ENABLE_BT) return
          val promise =
              synchronized(lock) {
                val current = pending
                pending = null
                current
              } ?: return
          promise.resolve(onMap(resultCode == Activity.RESULT_OK || isOn()))
        }
      }

  private fun onMap(on: Boolean) = Arguments.createMap().apply { putBoolean("on", on) }

  private fun isOn(): Boolean =
      try {
        BtAccess.adapter(ctx)?.isEnabled == true
      } catch (e: SecurityException) {
        false
      }

  fun request(promise: Promise) {
    val adapter = BtAccess.adapter(ctx)
    if (adapter == null) {
      promise.reject(BridgeCodes.UNSUPPORTED, Messages.of(BridgeCodes.UNSUPPORTED))
      return
    }
    if (!BtAccess.hasConnect(ctx)) {
      promise.reject(BridgeCodes.UNAUTHORIZED, Messages.of(BridgeCodes.UNAUTHORIZED))
      return
    }
    if (isOn()) {
      promise.resolve(onMap(true))
      return
    }
    synchronized(lock) {
      if (pending != null) {
        promise.reject(BridgeCodes.BUSY, Messages.of(BridgeCodes.BUSY))
        return
      }
      pending = promise
    }
    UiThreadUtil.runOnUiThread(Runnable { launch() })
  }

  private fun launch() {
    val activity = ctx.currentActivity
    var failure: String? = null
    if (activity == null) {
      failure = BridgeCodes.UNSUPPORTED
    } else {
      try {
        activity.startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQUEST_ENABLE_BT)
      } catch (e: SecurityException) {
        failure = BridgeCodes.UNAUTHORIZED
      } catch (e: ActivityNotFoundException) {
        failure = BridgeCodes.UNSUPPORTED
      }
    }
    if (failure != null) {
      val promise = synchronized(lock) {
        val current = pending
        pending = null
        current
      }
      promise?.reject(failure, Messages.of(failure))
    }
  }
}
