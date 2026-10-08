package com.possoftware.pos.printer

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType

/**
 * Phase 3 Session 3D (spec §9.5): a WebView remounted while the app is hidden must load now, not when someone next opens
 * the app. React Native mounts nothing while its screen is paused (Fabric's frame callback stops with the activity), so the
 * new WebView would only exist, and its page only load, at the next open. While the app is hidden this lets Fabric mount
 * for a moment ([WINDOW_MS] at most), until the new page answers, then pauses it again; once the app is visible React
 * Native's own lifecycle runs it. The dead page's WebView is let go at once, so nothing drives it again. Main thread only.
 */
object BackgroundMount {
  const val WINDOW_MS = 30_000L
  const val CHECK_MS = 1_000L

  /** The gold's review (I-2): at most one hidden mount per 10 minutes. */
  const val GAP_MS = 600_000L

  private val main = Handler(Looper.getMainLooper())
  private var resumed: LifecycleEventListener? = null
  private var until = 0L
  private val gap = HiddenMountGap(GAP_MS)

  fun start(context: ReactContext) {
    main.post(
        Runnable {
          WebViewDelivery.detach()
          if (PrinterPool.appVisible) return@Runnable
          if (!gap.allow(SystemClock.elapsedRealtime())) return@Runnable
          val fabric = UIManagerHelper.getUIManager(context, UIManagerType.FABRIC) as? LifecycleEventListener ?: return@Runnable
          until = SystemClock.uptimeMillis() + WINDOW_MS
          if (resumed == null) {
            resumed = fabric
            fabric.onHostResume()
            main.postDelayed(check, CHECK_MS)
          }
        }
    )
  }

  private val check =
      object : Runnable {
        override fun run() {
          if (resumed == null) return
          if (PrinterPool.appVisible) {
            // The app is open: React Native's own lifecycle runs Fabric now.
            resumed = null
            return
          }
          if (SystemClock.uptimeMillis() >= until) {
            stop()
            return
          }
          WebViewDelivery.probePage { alive -> if (alive) stop() }
          main.postDelayed(this, CHECK_MS)
        }
      }

  private fun stop() {
    val fabric = resumed ?: return
    resumed = null
    main.removeCallbacks(check)
    if (!PrinterPool.appVisible) fabric.onHostPause()
  }
}
