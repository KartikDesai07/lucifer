package com.possoftware.pos.printer

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import java.lang.ref.WeakReference
import org.json.JSONObject

/**
 * Native-direct app -> page delivery. React view commands stall while the app is paused, so the
 * WebView is resolved by React tag once and driven with evaluateJavascript from here.
 */
object WebViewDelivery {
  private const val VERSION = BridgeCodes.BRIDGE_VERSION
  private const val BACKSLASH_CODE = 0x5C
  private const val HEX_RADIX = 16
  private const val HEX_WIDTH = 4

  /** The page is alive when the injected bridge function still exists (evaluateJavascript answers JSON). */
  private const val PROBE_SCRIPT = "typeof window.__posNativeDeliver"
  private const val PROBE_ANSWER = "\"function\""

  /** U+2028, U+2029, '<', '>', '&' are escaped so the script is safe in any parsing context. */
  private val ESCAPED_CODES = intArrayOf(0x2028, 0x2029, 0x3C, 0x3E, 0x26)

  private val main = Handler(Looper.getMainLooper())

  @Volatile private var webView: WeakReference<WebView>? = null
  private var scriptHandler: ScriptHandler? = null // UI thread only
  private var scriptOwner: WeakReference<WebView>? = null // the WebView scriptHandler belongs to; UI thread only

  /**
   * Resolves the WebView behind [tag] and installs [script] at document start for [origin].
   * Must run on the UI thread. Returns null when the view cannot be resolved (yet), else whether
   * document-start injection is active.
   */
  fun attach(context: ReactContext, tag: Int, script: String, origin: String): Boolean? {
    val manager = UIManagerHelper.getUIManager(context, UIManagerType.FABRIC) ?: return null
    val root: View? =
        try {
          manager.resolveView(tag)
        } catch (e: RuntimeException) {
          null
        }
    val found = findWebView(root) ?: return null
    // Phase 3 Session 3D (the gold's review, I-2): the page's renderer keeps the app's importance while hidden (the app
    // runs a foreground service while it prints), so Android does not kill it before the app itself.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) found.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    webView = WeakReference(found)
    removeScript(found)
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false
    return try {
      scriptHandler = WebViewCompat.addDocumentStartJavaScript(found, script, setOf(origin))
      scriptOwner = WeakReference(found)
      true
    } catch (e: RuntimeException) {
      false
    }
  }

  /**
   * Phase 3 Session 3D (the 3C review gate's emulator run): the WebView freezes the page of a window that stays hidden
   * (within about a minute: no timer, no request, no slip until the app is opened again). While the app is hidden the
   * print host's tick tells the page's WebView its window is visible, so the page keeps running as it does on screen,
   * as the Windows app's page does in the tray; nothing is drawn, and Android hides it again whenever the activity stops.
   */
  fun keepPageRunning() {
    main.post(Runnable { webView?.get()?.dispatchWindowVisibilityChanged(View.VISIBLE) })
  }

  fun detach() {
    webView = null
    scriptHandler = null
    scriptOwner = null
  }

  // Only a handler of [current] is removed (a re-attach to the same WebView). A remount attaches a
  // NEW WebView; the previous one is already destroyed, and ScriptHandler.remove() on a destroyed
  // WebView crashes Chromium natively (SIGSEGV on WebView 109), which no try/catch can stop. Its
  // scripts die with it anyway.
  private fun removeScript(current: WebView) {
    val old = scriptHandler
    val owner = scriptOwner?.get()
    scriptHandler = null
    scriptOwner = null
    if (old == null || owner !== current) return
    try {
      old.remove()
    } catch (e: RuntimeException) {
      // The WebView is being torn down.
    }
  }

  private fun findWebView(view: View?): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val child = findWebView(view.getChildAt(i))
        if (child != null) return child
      }
    }
    return null
  }

  /** Runs a script built by the JS layer (request replies). No attached WebView is a silent no-op. */
  fun deliverScript(script: String) {
    main.post(
        Runnable {
          try {
            webView?.get()?.evaluateJavascript(script, null)
          } catch (e: RuntimeException) {
            // The WebView was destroyed between attach and delivery.
          }
        }
    )
  }

  /**
   * Asks the page whether the bridge answers. [onResult] runs on the UI thread with whether the
   * answer was right; it never runs when there is no WebView or the page cannot run script.
   */
  fun probePage(onResult: (Boolean) -> Unit) {
    main.post(
        Runnable {
          try {
            webView?.get()?.evaluateJavascript(PROBE_SCRIPT) { answer -> onResult(answer == PROBE_ANSWER) }
          } catch (e: RuntimeException) {
            // The WebView was destroyed: no answer counts as dead.
          }
        }
    )
  }

  /** Builds and delivers a {v,event,data} message; works while the app is backgrounded. Session 2F2: [version] is the
   *  bridge version whose listeners get it (the page's injected script routes by it). */
  fun deliverEvent(event: String, data: JSONObject, version: Int = VERSION) {
    val message = JSONObject()
    message.put("v", version)
    message.put("event", event)
    message.put("data", data)
    val call = "window.__posNativeDeliver && window.__posNativeDeliver(" + escapeForScript(message.toString()) + ");"
    deliverScript(call)
  }

  /** Escapes JSON text for embedding in script; the escaped characters only occur inside strings. */
  fun escapeForScript(json: String): String {
    val out = StringBuilder(json.length + json.length / HEX_WIDTH)
    for (ch in json) {
      if (ESCAPED_CODES.contains(ch.code)) {
        out.append(Char(BACKSLASH_CODE)).append('u')
        out.append(Integer.toString(ch.code, HEX_RADIX).padStart(HEX_WIDTH, '0'))
      } else {
        out.append(ch)
      }
    }
    return out.toString()
  }
}
