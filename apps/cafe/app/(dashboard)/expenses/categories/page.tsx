import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { ExpenseCategoriesManager } from "@/components/expenses/ExpenseCategoriesManager";

// Admin only (also in ADMIN_ROUTES, so staff never reach it): add, rename, hide
// and show the categories the Add expense sheet offers.
export default function ExpenseCategoriesPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <ExpenseCategoriesManager />
      </MenuPageShell>
    </AdminGuard>
  );
}
