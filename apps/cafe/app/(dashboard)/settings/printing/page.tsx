// The printing settings page. Rebuilt simple on 2026-09-19 (owner: the page
// "pura kharab hai", remove the unused and the extra, keep one clear view).
//
// It used to carry a five-step wizard for downloading a .bat that launched
// Chrome in kiosk-printing mode — the workaround from before the Windows
// desktop app existed. That is gone; PrinterSetupCard is now the whole page:
// name this PC as the print host, pick its printer, test print, and remove the
// host if the PC is down. Server component: no hooks of its own. Its header is
// the shared settings one (the "‹ Settings" eyebrow), like every section page.
import { AdminGuard } from "@/components/shared/AdminGuard";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";

export default function PrinterSetupPage() {
  return (
    <AdminGuard>
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
        <SettingsPageHeader
          title="Printer setup"
          description="Choose the PC that prints, pick its printer, and print a test slip."
        />
        <PrinterSetupCard />
      </div>
    </AdminGuard>
  );
}
