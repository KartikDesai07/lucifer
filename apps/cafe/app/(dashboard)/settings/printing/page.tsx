// The printing settings page. Rebuilt simple on 2026-09-19 (owner: the page
// "pura kharab hai", remove the unused and the extra, keep one clear view).
//
// It used to carry a five-step wizard for downloading a .bat that launched
// Chrome in kiosk-printing mode — the workaround from before the Windows
// desktop app existed. That is gone; PrinterSetupCard is now the whole page:
// name this PC as the print host, pick its printer, test print, and remove the
// host if the PC is down. Server component: no hooks of its own.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";
import { SETTINGS_BASE_PATH } from "@/lib/settings-sections";

export default function PrinterSetupPage() {
  return (
    <AdminGuard>
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
        <div className="space-y-1">
          <Link
            href={SETTINGS_BASE_PATH}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Settings
          </Link>
          <PageHeader
            title="Printer setup"
            description="Choose the PC that prints, pick its printer, and print a test slip."
          />
        </div>
        <PrinterSetupCard />
      </div>
    </AdminGuard>
  );
}
