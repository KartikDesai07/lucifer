package com.possoftware.pos.update

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Native apps 2.0 (spec §6): registers the legacy (non-Turbo) PosUpdate module; the interop layer serves it under
 *  Fabric, as PosPrinterPackage does. */
class PosUpdatePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == PosUpdateModule.NAME) PosUpdateModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
      ReactModuleInfoProvider {
        mapOf(
            PosUpdateModule.NAME to
                ReactModuleInfo(
                    PosUpdateModule.NAME,
                    PosUpdateModule::class.java.name,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    false, // isTurboModule: legacy module through the interop layer
                )
        )
      }
}
