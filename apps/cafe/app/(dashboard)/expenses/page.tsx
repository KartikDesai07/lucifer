import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { ExpensesView } from "@/components/expenses/ExpensesView";

// Expenses — open to every role (staff add; an admin sees and edits everything).
// The Categories and Report pages beside it are admin-only.
export default function ExpensesPage() {
  return (
    <MenuPageShell>
      <ExpensesView />
    </MenuPageShell>
  );
}
