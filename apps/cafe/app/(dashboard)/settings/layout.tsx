import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";

// CB-UI1 S2 — every settings route (hub + the section pages) is admin-only.
// Printer setup is NOT a settings route any more: it lives at /printers
// (owner, 2026-10-02) with its own AdminGuard.
//
// Settings pass (2026-10-01) — every settings route sits in the brand shell
// (paper page, brand type, the min-w-0 column), inside the guard: the order
// the Staff page uses. Each page keeps its own readable form width.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <MenuPageShell>{children}</MenuPageShell>
    </AdminGuard>
  );
}
