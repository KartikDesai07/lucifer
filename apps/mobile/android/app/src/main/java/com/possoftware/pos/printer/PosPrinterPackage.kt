package com.possoftware.pos.printer

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers the legacy (non-Turbo) PosPrinter module; the interop layer serves it under Fabric. */
class PosPrinterPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == PosPrinterModule.NAME) PosPrinterModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
      ReactModuleInfoProvider {
        mapOf(
            PosPrinterModule.NAME to
                ReactModuleInfo(
                    PosPrinterModule.NAME,
                    PosPrinterModule::class.java.name,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    false, // isTurboModule: legacy module through the interop layer
                )
        )
      }
}
