// The Printer setup page (sidebar: Admin, above Settings): the same printer
// panel as the top-bar printer button, inline. Server component with no hooks
// of its own. Admin-only like Staff and Settings: the guard wraps the brand
// shell (middleware's ADMIN_ROUTES is the first fence, this the second), and
// the column width matches the settings section pages.
import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { PrinterPanel } from "@/components/print/PrinterPanel";

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
        </div>
      </MenuPageShell>
    </AdminGuard>
  );
}
