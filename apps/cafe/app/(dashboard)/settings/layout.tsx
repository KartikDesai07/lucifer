import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";

// CB-UI1 S2 — every settings route (hub + the 7 section pages) is admin-only.
// /settings/printing keeps its OWN AdminGuard (design contract) since it
// predates this layout; wrapping it here too is harmless (AdminGuard just
// nests) but the extra guard there is left alone, out of this slice's scope.
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
