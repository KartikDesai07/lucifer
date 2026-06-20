import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  Plus,
  Minus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useOrders,
  useProducts,
  useCustomers,
  useTableStatuses,
  inr,
  PAY_STYLES,
  orderDue,
  isOrderPaid,
  nextOrderId,
  priceAfter,
  type Order,
  type OrderItem,
  type PaymentMode,
  type Product,
} from "@/lib/storage";
import { toast } from "sonner";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Lucifer Cafe POS" },
      { name: "description", content: "Browse, search and filter orders by table number, customer or order id." },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const [orders, setOrders] = useOrders();
  const [, setTableStatuses] = useTableStatuses();
  const [q, setQ] = useState("");
  const [tableQ, setTableQ] = useState("");
  const [scope, setScope] = useState<"all" | "dinein" | "takeaway">("all");

  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [reorderFrom, setReorderFrom] = useState<Order | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const tq = tableQ.trim().toLowerCase();
    return [...orders].reverse().filter((o) => {
      if (scope === "dinein" && !o.tableNo) return false;
      if (scope === "takeaway" && o.tableNo) return false;
      if (tq && !(o.tableNo || "").toLowerCase().includes(tq)) return false;
      if (!query) return true;
      return (
        o.id.toLowerCase().includes(query) ||
        o.customerName.toLowerCase().includes(query) ||
        (o.customerMobile || "").includes(query) ||
        (o.tableNo || "").toLowerCase().includes(query)
      );
    });
  }, [orders, q, tableQ, scope]);

  const totals = useMemo(() => ({
    count: filtered.length,
    sum: filtered.reduce((s, o) => s + o.total, 0),
  }), [filtered]);

  const confirmDelete = () => {
    if (!deleteId) return;
    setOrders((p) => p.filter((o) => o.id !== deleteId));
    toast.success(`Order ${deleteId} deleted`);
    setDeleteId(null);
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h2 className="text-2xl font-bold">Orders</h2>
        <p className="text-sm text-muted-foreground">Search by order, customer or table number.</p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order id, name, mobile, table..." className="pl-9" />
        </div>
        <Input
          value={tableQ}
          onChange={(e) => setTableQ(e.target.value.toUpperCase())}
          placeholder="Filter by Table No (e.g. T-5)"
          className="w-[200px]"
        />
        <div className="flex gap-1">
          {(["all", "dinein", "takeaway"] as const).map((s) => (
            <Button key={s} size="sm" variant={scope === s ? "default" : "outline"} onClick={() => setScope(s)}>
              {s === "all" ? "All" : s === "dinein" ? "Dine-in" : "Takeaway"}
            </Button>
          ))}
        </div>
      </Card>

      <div className="text-xs text-muted-foreground">
        {totals.count} orders · Total {inr(totals.sum)}
      </div>

      <Card className="p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-10">No orders match.</div>
        ) : (
          <div className="divide-y">
            {filtered.map((o) => {
              const due = orderDue(o);
              const paid = isOrderPaid(o);
              const pay = PAY_STYLES[o.payment] ?? PAY_STYLES.Cash;
              return (
                <div key={o.id} className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{o.id}</span>
                      {o.tableNo ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary text-primary-foreground">
                          TABLE {o.tableNo}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">Takeaway</span>
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pay.bg} ${pay.text}`}>
                        {pay.label}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${paid ? "bg-green-500" : "bg-red-500"}`}>
                        {paid ? "PAID" : "UNPAID"}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          o.status === "Completed"
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {o.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {o.customerName}
                      {o.customerMobile ? ` · ${o.customerMobile}` : ""} · {o.items.length} items · {new Date(o.date).toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{inr(o.total)}</div>
                    {due > 0 && <div className="text-[10px] text-red-600 font-semibold">Due {inr(due)}</div>}
                    <div className="text-[10px] text-muted-foreground">by {o.receiver}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {o.status === "Pending" && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setOrders((p) => p.map((x) => x.id === o.id ? { ...x, status: "Completed" } : x));
                          if (o.tableNo) {
                            const tNo = o.tableNo;
                            const othersOpen = orders.some(
                              (x) => x.id !== o.id && x.status === "Pending" && x.tableNo === tNo,
                            );
                            if (!othersOpen) {
                              setTableStatuses((prev) => ({ ...prev, [tNo]: "Available" }));
                            }
                          }
                          toast.success(`Order ${o.id} closed${o.tableNo ? ` · Table ${o.tableNo} freed` : ""}`);
                        }}
                      >
                        Close Order
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" title="View order" onClick={() => setViewOrder(o)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Reorder" onClick={() => setReorderFrom(o)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete order"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(o.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* View order dialog */}
      <Dialog open={!!viewOrder} onOpenChange={(o) => !o && setViewOrder(null)}>
        <DialogContent className="max-w-lg">
          {viewOrder && (
            <>
              <DialogHeader>
                <DialogTitle>{viewOrder.id}</DialogTitle>
                <DialogDescription>
                  {new Date(viewOrder.date).toLocaleString("en-IN")} · {viewOrder.tableNo ?? "Takeaway"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium">{viewOrder.customerName}</div>
                  {viewOrder.customerMobile && <div className="text-xs text-muted-foreground">{viewOrder.customerMobile}</div>}
                </div>
                <div className="border rounded divide-y">
                  {viewOrder.items.map((it, i) => (
                    <div key={i} className="flex justify-between px-3 py-2">
                      <span>{it.name} × {it.qty}</span>
                      <span>{inr(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-base font-semibold border-t pt-2">
                  <span>Total</span><span>{inr(viewOrder.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Payment: {viewOrder.payment} · Status: {viewOrder.status}
                  {orderDue(viewOrder) > 0 && (
                    <span className="text-red-600 font-semibold"> · Due {inr(orderDue(viewOrder))}</span>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reorder dialog */}
      {reorderFrom && (
        <ReorderDialog
          source={reorderFrom}
          onClose={() => setReorderFrom(null)}
          onSaved={(newOrder) => {
            setOrders((p) => [...p, newOrder]);
            toast.success(`Reorder ${newOrder.id} saved`);
            setReorderFrom(null);
          }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order {deleteId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The order will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Reorder dialog ============

function ReorderDialog({
  source,
  onClose,
  onSaved,
}: {
  source: Order;
  onClose: () => void;
  onSaved: (order: Order) => void;
}) {
  const [orders] = useOrders();
  const [products] = useProducts();
  const [customers, setCustomers] = useCustomers();

  const [name, setName] = useState(source.customerName);
  const [mobile, setMobile] = useState(source.customerMobile ?? "");
  const [items, setItems] = useState<OrderItem[]>(
    source.items.map((it) => ({ ...it })),
  );
  const [discount, setDiscount] = useState<number>(source.discount ?? 0);
  const [payment, setPayment] = useState<PaymentMode>(
    source.payment === "Credit" ? "Due" : source.payment,
  );
  const [splitCash, setSplitCash] = useState<string>(String(source.splitCash ?? 0));
  const [splitOnline, setSplitOnline] = useState<string>(String(source.splitOnline ?? 0));
  const [now, setNow] = useState(() => new Date());
  const [productQ, setProductQ] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Refresh prices from current product list
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        return p ? { ...it, price: priceAfter(p), name: p.name } : it;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + it.price * it.qty, 0),
    [items],
  );
  const total = Math.max(0, subtotal - (discount || 0));

  const cashNum = Math.max(0, Math.min(total, Number(splitCash) || 0));
  const onlineNum = Math.max(0, Math.min(total - cashNum, Number(splitOnline) || 0));
  const dueNum = Math.max(0, total - cashNum - onlineNum);

  const paidAmount =
    payment === "Cash" || payment === "Online"
      ? total
      : payment === "Split"
        ? cashNum + onlineNum
        : 0;

  const filteredProducts = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    if (!q) return products.slice(0, 12);
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
  }, [products, productQ]);

  const addProduct = (p: Product) => {
    setItems((prev) => {
      const existing = prev.find((it) => it.productId === p.id);
      if (existing) {
        return prev.map((it) =>
          it.productId === p.id ? { ...it, qty: it.qty + 1 } : it,
        );
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, price: priceAfter(p), qty: 1 },
      ];
    });
  };

  const changeQty = (id: string, delta: number) =>
    setItems((prev) =>
      prev
        .map((it) =>
          it.productId === id ? { ...it, qty: Math.max(0, it.qty + delta) } : it,
        )
        .filter((it) => it.qty > 0),
    );

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((it) => it.productId !== id));

  const buildOrder = (status: Order["status"]): Order | null => {
    if (items.length === 0) {
      toast.error("Add at least one item");
      return null;
    }
    if (payment === "Split" && cashNum === 0 && onlineNum === 0) {
      toast.error("Enter Cash or UPI amount for split payment");
      return null;
    }

    // Upsert customer if mobile provided
    let customerId = source.customerId;
    if (mobile.trim()) {
      const existing = customers.find((c) => c.mobile === mobile.trim());
      if (existing) {
        customerId = existing.id;
        setCustomers((p) =>
          p.map((c) =>
            c.id === existing.id
              ? { ...c, visits: c.visits + 1, totalSpend: c.totalSpend + total, name: name || c.name }
              : c,
          ),
        );
      }
    }

    return {
      id: nextOrderId(orders),
      date: new Date().toISOString(),
      customerId,
      customerName: name || "Walk-in",
      customerMobile: mobile || undefined,
      items,
      subtotal,
      discount: discount || 0,
      total,
      paidAmount,
      payment,
      splitCash: payment === "Split" ? cashNum : undefined,
      splitOnline: payment === "Split" ? onlineNum : undefined,
      splitDue: payment === "Split" ? dueNum : undefined,
      status,
      receiver: source.receiver,
      tableNo: source.tableNo,
    };
  };

  const handleSave = () => {
    const order = buildOrder("Pending");
    if (order) onSaved(order);
  };

  const handlePrintClose = () => {
    const order = buildOrder("Completed");
    if (!order) return;
    onSaved(order);
    setTimeout(() => printBill(order), 100);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Reorder from {source.id}
          </DialogTitle>
          <DialogDescription>
            {now.toLocaleString("en-IN")} · {source.tableNo ?? "Takeaway"}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-4 space-y-5 flex-1">
          {/* Customer */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Customer Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Mobile</Label>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
            </div>
          </section>

          {/* Items */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Order Items</h3>
              <span className="text-xs text-muted-foreground">{items.length} items</span>
            </div>
            <div className="border rounded-md divide-y">
              {items.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">No items. Add from menu below.</div>
              )}
              {items.map((it) => (
                <div key={it.productId} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{inr(it.price)} each</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(it.productId, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{it.qty}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(it.productId, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="w-20 text-right text-sm font-semibold">{inr(it.price * it.qty)}</div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(it.productId)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* Add from menu */}
          <section>
            <Label className="text-xs">Add Item from Menu</Label>
            <div className="relative mt-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
                placeholder="Search products..."
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className="text-left border rounded-md p-2 hover:bg-accent transition-colors"
                >
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{inr(priceAfter(p))}</div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full text-xs text-muted-foreground text-center py-4">No products found.</div>
              )}
            </div>
          </section>

          {/* Payment summary */}
          <section className="bg-muted/40 rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Subtotal</span><span className="font-medium">{inr(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <Label className="text-xs">Discount (₹)</Label>
              <Input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-28 text-right"
              />
            </div>
            <div className="flex items-center justify-between text-base font-bold border-t pt-2">
              <span>Total</span><span>{inr(total)}</span>
            </div>

            <div>
              <Label className="text-xs">Payment Method</Label>
              <Select value={payment} onValueChange={(v) => setPayment(v as PaymentMode)}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Online">UPI / Online</SelectItem>
                  <SelectItem value="Split">Split (Cash + UPI)</SelectItem>
                  <SelectItem value="Due">Due</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {payment === "Split" && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Cash</Label>
                  <Input
                    type="number"
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">UPI</Label>
                  <Input
                    type="number"
                    value={splitOnline}
                    onChange={(e) => setSplitOnline(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">Balance Due</Label>
                  <div className={`h-9 mt-1 rounded-md border px-3 flex items-center font-semibold ${dueNum > 0 ? "text-red-600" : "text-green-600"}`}>
                    {inr(dueNum)}
                  </div>
                </div>
              </div>
            )}

            {payment === "Due" && (
              <div className="text-xs text-red-600 font-medium">Entire {inr(total)} will be marked as due.</div>
            )}
          </section>
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-background flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={handleSave}>
            <RefreshCw className="h-4 w-4" /> Save Reorder
          </Button>
          <Button onClick={handlePrintClose}>
            <Printer className="h-4 w-4" /> Print Bill &amp; Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function printBill(o: Order) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  const lines = o.items
    .map(
      (it) =>
        `<tr><td>${it.name} × ${it.qty}</td><td style="text-align:right">${inr(it.price * it.qty)}</td></tr>`,
    )
    .join("");
  const splitRows =
    o.payment === "Split"
      ? `<tr><td>Cash</td><td style="text-align:right">${inr(o.splitCash ?? 0)}</td></tr>
         <tr><td>UPI</td><td style="text-align:right">${inr(o.splitOnline ?? 0)}</td></tr>
         <tr><td>Due</td><td style="text-align:right;color:#dc2626">${inr(o.splitDue ?? 0)}</td></tr>`
      : "";
  w.document.write(`<!doctype html><html><head><title>${o.id}</title>
    <style>body{font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:12px;color:#000}
    h2{margin:0 0 4px;text-align:center}table{width:100%;border-collapse:collapse}
    td{padding:2px 0}.line{border-top:1px dashed #000;margin:6px 0}</style></head><body>
    <h2>Lucifer Cafe</h2>
    <div style="text-align:center">${new Date(o.date).toLocaleString("en-IN")}</div>
    <div style="text-align:center"><b>${o.id}</b>${o.tableNo ? ` · ${o.tableNo}` : ""}</div>
    <div class="line"></div>
    <div>${o.customerName}${o.customerMobile ? ` · ${o.customerMobile}` : ""}</div>
    <div class="line"></div>
    <table>${lines}</table>
    <div class="line"></div>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">${inr(o.subtotal ?? o.total)}</td></tr>
      ${o.discount ? `<tr><td>Discount</td><td style="text-align:right">-${inr(o.discount)}</td></tr>` : ""}
      <tr><td><b>Total</b></td><td style="text-align:right"><b>${inr(o.total)}</b></td></tr>
      <tr><td>Payment</td><td style="text-align:right">${o.payment}</td></tr>
      ${splitRows}
    </table>
    <div class="line"></div>
    <div style="text-align:center">Thank you!</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
    </body></html>`);
  w.document.close();
}
