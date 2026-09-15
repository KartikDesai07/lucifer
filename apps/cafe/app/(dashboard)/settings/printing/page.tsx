// Print-standardization plan (.claude/plan/v2/print-standardization-plan.md
// §B2, slice A2) — the self-service printer setup wizard's page shell. No
// hooks of its own, so this stays a server component (mirrors the sibling
// settings/page.tsx idiom otherwise: AdminGuard-wrapped, h2 + one-line intro).
// PH-10b (D3): the Print host card now lives here too, ABOVE the wizard —
// moved off /requests so the per-device toggles get the whole screen there.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PrintHostCard } from "@/components/print/PrintHostCard";
import { PrinterSetupWizard } from "@/components/print/PrinterSetupWizard";
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
            description={
              'Make this PC the print host and turn on silent printing with the "POS Printer" shortcut — set up once, used on every order.'
            }
          />
        </div>
        <PrintHostCard />
        <PrinterSetupWizard />
      </div>
    </AdminGuard>
  );
}
