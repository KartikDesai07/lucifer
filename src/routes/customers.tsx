import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomers, useOrders, type Customer, uid, inr, orderDue, PAY_STYLES } from "@/lib/storage";
import { Plus, Search, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Lucifer Cafe POS" },
      { name: "description", content: "Manage café customers, visits and spending." },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const [customers, setCustomers] = useCustomers();
  const [orders] = useOrders();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Map of customerId -> { due, orders }
  const dueByCustomer = useMemo(() => {
    const map: Record<string, { due: number; orders: typeof orders }> = {};
    orders.forEach((o) => {
      if (!o.customerId) return;
      const due = orderDue(o);
      if (due <= 0) return;
      if (!map[o.customerId]) map[o.customerId] = { due: 0, orders: [] };
      map[o.customerId].due += due;
      map[o.customerId].orders.push(o);
    });
    return map;
  }, [orders]);

  const filtered = customers.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.mobile.includes(q)
  );

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("Name required");
    setCustomers((prev) => {
      if (editing.id) return prev.map((c) => (c.id === editing.id ? editing : c));
      return [...prev, { ...editing, id: uid() }];
    });
    toast.success("Saved");
    setOpen(false);
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or mobile" className="pl-9" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing({ id: "", name: "", mobile: "", visits: 0, totalSpend: 0, notes: "" }); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "Add"} Customer</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div><Label>Mobile</Label><Input value={editing.mobile} onChange={(e) => setEditing({ ...editing, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
                <div>
                  <Label>Tag</Label>
                  <Select value={editing.notes || "none"} onValueChange={(v) => setEditing({ ...editing, notes: v === "none" ? "" : (v as Customer["notes"]) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Regular">Regular</SelectItem>
                      <SelectItem value="VIP">VIP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(() => {
        const totalDue = Object.values(dueByCustomer).reduce((s, v) => s + v.due, 0);
        return totalDue > 0 ? (
          <div className="text-sm">
            Total outstanding due across customers: <span className="font-bold text-red-600">{inr(totalDue)}</span>
          </div>
        ) : null;
      })()}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8"></th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Mobile</th>
                <th className="text-right p-3">Visits</th>
                <th className="text-right p-3">Spend</th>
                <th className="text-right p-3">Due</th>
                <th className="text-left p-3">Tag</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const info = dueByCustomer[c.id];
                const hasDue = !!info && info.due > 0;
                const isOpen = expanded === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr
                      key={c.id}
                      className={`border-t ${hasDue ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      onClick={() => hasDue && setExpanded(isOpen ? null : c.id)}
                    >
                      <td className="px-2 text-muted-foreground">
                        {hasDue ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                      </td>
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 text-muted-foreground">{c.mobile || "—"}</td>
                      <td className="p-3 text-right">{c.visits}</td>
                      <td className="p-3 text-right">{inr(c.totalSpend)}</td>
                      <td className="p-3 text-right">
                        {hasDue ? (
                          <span className="font-bold text-red-600">{inr(info.due)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {c.notes && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.notes === "VIP" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                            {c.notes}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setCustomers((p) => p.filter((x) => x.id !== c.id))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </td>
                    </tr>
                    {isOpen && hasDue && (
                      <tr className="border-t bg-muted/20">
                        <td></td>
                        <td colSpan={7} className="p-3">
                          <div className="text-xs uppercase text-muted-foreground mb-2">Unpaid orders</div>
                          <div className="space-y-1">
                            {info.orders.map((o) => {
                              const pay = PAY_STYLES[o.payment] ?? PAY_STYLES.Cash;
                              return (
                                <Link
                                  key={o.id}
                                  to="/pos"
                                  search={{ edit: o.id }}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-background"
                                >
                                  <span className="font-medium">{o.id}</span>
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pay.bg} ${pay.text}`}>{pay.label}</span>
                                  <span className="text-xs text-muted-foreground flex-1">{new Date(o.date).toLocaleString("en-IN")}</span>
                                  <span className="text-xs">{inr(o.total)}</span>
                                  <span className="font-bold text-red-600 text-sm w-20 text-right">Due {inr(orderDue(o))}</span>
                                </Link>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">No customers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
