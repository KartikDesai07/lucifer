# Project ProGuard / R8 rules for release builds (R8 is on: see enableProguardInReleaseBuilds in build.gradle).
# React Native's own consumer rules (bundled in react-android) already keep every NativeModule implementation
# (the printer bridge, PosPrinterModule) and every @ReactProp. Only what those rules do not cover lives here.

# react-native-webview: the page -> app bridge is a @JavascriptInterface method. R8 must keep its name, or the POS
# page can no longer reach the app. The library ships no consumer rules of its own.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.reactnativecommunity.webview.** { *; }
