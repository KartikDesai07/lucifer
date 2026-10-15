// The Printer setup page (sidebar: Admin, above Settings): the same printer
// panel as the top-bar printer button, inline. Server component with no hooks
// of its own. Admin-only like Staff and Settings: the guard wraps the brand
// shell (middleware's ADMIN_ROUTES is the first fence, this the second), and
// the column width matches the settings section pages. Phase 2 Session 2D
// (spec §11, plan decision 11): the outlet's Printers, Kitchen stations and
// Devices follow the panel. Native apps 2.0 (the owner, 2026-10-15): then the
// apps to download, streamed so the page never waits on files.sandbee.in.
import { Suspense } from "react";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { PrinterPanel } from "@/components/print/PrinterPanel";
import { PrintSetupSections } from "@/components/print/setup/PrintSetupSections";
import { NativeAppsSection } from "@/components/print/setup/NativeAppsSection";

const APPS_LOADING = "Loading the apps…";

export default function PrinterSetupPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
          <PageHeader
            eyebrow="Admin"
            title="Printer setup"
            description="Choose where slips print and connect the printer on this device."
          />
          <PrinterPanel />
          <PrintSetupSections />
          <Suspense fallback={<p role="status" className="text-brand-muted">{APPS_LOADING}</p>}>
            <NativeAppsSection />
          </Suspense>
        </div>
      </MenuPageShell>
    </AdminGuard>
  );
}
