import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { InventoryView } from "@/components/inventory/InventoryView";

// Inventory - open to every role (staff see the stock). Adding, editing and archiving a stock item are admin-only
// inside the view, and the server refuses them for anyone else.
export default function InventoryPage() {
  return (
    <MenuPageShell>
      <InventoryView />
    </MenuPageShell>
  );
}
