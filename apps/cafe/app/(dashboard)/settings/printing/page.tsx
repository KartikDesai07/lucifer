// The printing settings page: the same printer panel as the top-bar printer
// button, inline. Server component with no hooks of its own. No guard here and
// no narrow column of its own: settings/layout.tsx guards every settings
// route, and the width matches the section pages (SettingsSectionPage).
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { PrinterPanel } from "@/components/print/PrinterPanel";

export default function PrinterSetupPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
      <SettingsPageHeader
        title="Printer setup"
        description="Choose where slips print and connect the printer on this device."
      />
      <PrinterPanel />
    </div>
  );
}
