import { Download, Monitor, Smartphone } from "lucide-react";

import { PrinterSection } from "@/components/print/PrinterSection";
import { Button } from "@/components/ui/button";
import { readNativeApps } from "@/lib/native-apps";

const SECTION_DESCRIPTION =
  "Download the apps for this outlet's phones, tablets and counter PC. After this install they update themselves.";
const ANDROID_NOTE =
  "A phone with the old POS app (version 1.x): uninstall it first, then install this one, sign in, set its printer, and choose this device again for its printers under Printers above. Chrome may warn about the file: Download anyway, then open it and allow installs from Chrome once.";
const WINDOWS_NOTE =
  "Installs over the old Windows app and keeps its POS address and printers. Windows may say the publisher is unknown: More info, then Run anyway.";
const UPDATES_NOTE =
  "Updates: the POS app offers a new version when it is opened, and the Windows app installs one when it is closed. To update by hand, download the new version here and install it over the old one.";
const UNAVAILABLE = "Couldn't load the latest version. Check the internet connection and reload the page.";

// Native apps 2.0 (the owner's ask of 2026-10-15): the latest Android and Windows app, read on the server from
// files.sandbee.in (lib/native-apps.ts, cached for 10 minutes), under the printer setup. The links open outside the
// POS: the POS app and the Windows app hand an off-origin link to the system browser, which downloads the file.
export async function NativeAppsSection() {
  const { android, windows } = await readNativeApps();
  return (
    <PrinterSection icon={Download} title="Sandbee POS apps" description={SECTION_DESCRIPTION} data-native-apps>
      <div className="space-y-2 rounded-md border border-brand-rule p-3" data-native-app="android">
        <p className="flex items-center gap-2 font-medium text-brand-ink">
          <Smartphone aria-hidden="true" className="h-4 w-4" />
          POS app for Android{android !== null && <span className="font-normal text-brand-muted">version {android.version}</span>}
        </p>
        {android === null ? (
          <p className="text-brand-muted">{UNAVAILABLE}</p>
        ) : (
          <>
            <Button asChild>
              <a href={android.arm64Url} target="_blank" rel="noopener noreferrer">
                <Download aria-hidden="true" />
                Download for Android
              </a>
            </Button>
            {android.armv7Url !== null && (
              <p className="text-brand-muted">
                An old 32-bit phone?{" "}
                <a href={android.armv7Url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
                  Download this version instead
                </a>
                .
              </p>
            )}
            <p className="text-brand-muted">{ANDROID_NOTE}</p>
          </>
        )}
      </div>
      <div className="space-y-2 rounded-md border border-brand-rule p-3" data-native-app="windows">
        <p className="flex items-center gap-2 font-medium text-brand-ink">
          <Monitor aria-hidden="true" className="h-4 w-4" />
          Windows app{windows !== null && <span className="font-normal text-brand-muted">version {windows.version}</span>}
        </p>
        {windows === null ? (
          <p className="text-brand-muted">{UNAVAILABLE}</p>
        ) : (
          <>
            <Button asChild>
              <a href={windows.installerUrl} target="_blank" rel="noopener noreferrer">
                <Download aria-hidden="true" />
                Download for Windows
              </a>
            </Button>
            <p className="text-brand-muted">{WINDOWS_NOTE}</p>
          </>
        )}
      </div>
      <p className="text-brand-muted">{UPDATES_NOTE}</p>
    </PrinterSection>
  );
}
