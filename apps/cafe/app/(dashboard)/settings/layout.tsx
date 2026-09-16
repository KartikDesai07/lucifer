import { AdminGuard } from "@/components/shared/AdminGuard";

// CB-UI1 S2 — every settings route (hub + the 7 section pages) is admin-only.
// /settings/printing keeps its OWN AdminGuard (design contract) since it
// predates this layout; wrapping it here too is harmless (AdminGuard just
// nests) but the extra guard there is left alone, out of this slice's scope.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
