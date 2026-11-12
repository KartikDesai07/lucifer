import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { SuppliersView } from "@/components/inventory/SuppliersView";

// Admin only (also in ADMIN_ROUTES, so staff never reach it): who you buy stock from and what you owe each.
export default function SuppliersPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <SuppliersView />
      </MenuPageShell>
    </AdminGuard>
  );
}
