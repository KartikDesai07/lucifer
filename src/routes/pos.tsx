import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverAnchor,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus, Minus, Trash2, Printer, Search, MessageSquarePlus, X, Filter,
} from "lucide-react";
import {
  useProducts,
  useCustomers,
  useOrders,
  useStaff,
  useTableStatuses,
  TABLE_NUMBERS,
  type OrderItem,
  type Product,
  type Customer,
  type PaymentMode,
  type TableStatus,
  nextOrderId,
  inr,
  priceAfter,
  uid,
  PAY_STYLES,
} from "@/lib/storage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

type Payment = PaymentMode;

export const Route = createFileRoute("/pos")({
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
    reorder: typeof search.reorder === "string" ? search.reorder : undefined,
  }),
  head: () => ({
    meta: [
      { title: "POS — New Order — Lucifer Cafe" },
      { name: "description", content: "Fast point-of-sale: pick items, calculate total and print bill." },
    ],
  }),
  component: POS,
});

function POS() {
  const navigate = useNavigate();
  const { edit: editId, reorder: reorderId } = Route.useSearch();
  const [products, setProducts] = useProducts();
  const [customers, setCustomers] = useCustomers();
  const [orders, setOrders] = useOrders();
  const [staff] = useStaff();
  const [tableStatuses, setTableStatuses] = useTableStatuses();

  const [items, setItems] = useState<OrderItem[]>([]);
  const [custName, setCustName] = useState("");
  const [custMobile, setCustMobile] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [payment, setPayment] = useState<Payment>("Due");
  const [receiver, setReceiver] = useState("");
  const [tableNo, setTableNo] = useState("");
  const [discount, setDiscount] = useState<string>("");
  const [discountNote, setDiscountNote] = useState("");
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [splitCash, setSplitCash] = useState<string>("");
  const [splitOnline, setSplitOnline] = useState<string>("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [modIdx, setModIdx] = useState<number | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [postOrder, setPostOrder] = useState<Parameters<typeof printBill>[0] | null>(null);

  const cats = ["all", ...Array.from(new Set(products.map((p) => p.category)))];
  const filtered = products.filter(
    (p) => (cat === "all" || p.category === cat) && p.name.toLowerCase().includes(search.toLowerCase())
  );

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);
  const discountNum = Math.max(0, Math.min(Number(discount) || 0, subtotal));
  const total = Math.max(0, subtotal - discountNum);

  const splitCashRaw = Math.max(0, Number(splitCash) || 0);
  const splitCashNum = Math.min(splitCashRaw, total);
  const splitOnlineRaw = Math.max(0, Number(splitOnline) || 0);
  const splitOnlineNum = Math.min(splitOnlineRaw, Math.max(0, total - splitCashNum));
  const splitDueNum = Math.max(0, total - splitCashNum - splitOnlineNum);

  const paidNum =
    payment === "Split"
      ? splitCashNum + splitOnlineNum
      : paidAmount === ""
        ? (payment === "Due" ? 0 : total)
        : Math.max(0, Number(paidAmount) || 0);
  const dueNum = Math.max(0, total - paidNum);

  // Load existing order for edit
  useEffect(() => {
    if (!editId) return;
    const o = orders.find((x) => x.id === editId);
    if (!o) return;
    setItems(o.items);
    setCustName(o.customerName === "Walk-in" ? "" : o.customerName);
    setCustMobile(o.customerMobile || "");
    setPayment((o.payment === "Credit" ? "Due" : o.payment) as Payment);
    setReceiver(o.receiver || "");
    setTableNo(o.tableNo || "");
    setDiscount(o.discount ? String(o.discount) : "");
    setDiscountNote(o.discountNote || "");
    setPaidAmount(o.paidAmount != null ? String(o.paidAmount) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const reorderLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!reorderId || reorderLoaded.current === reorderId) return;
    const o = orders.find((x) => x.id === reorderId);
    if (!o) return;
    reorderLoaded.current = reorderId;
    setItems(o.items.map((i) => ({ ...i })));
    setCustName(o.customerName === "Walk-in" ? "" : o.customerName);
    setCustMobile(o.customerMobile || "");
    setPayment((o.payment === "Credit" ? "Due" : o.payment) as Payment);
    setReceiver(o.receiver || "");
    setTableNo(o.tableNo || "");
    setDiscount("");
    setDiscountNote("");
    setPaidAmount("");
    navigate({ to: "/pos", search: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderId]);

  // customer suggestions: any query string matches against BOTH name and mobile
  const suggestions = useMemo(() => {
    const queries = [custName.trim().toLowerCase(), custMobile.trim().toLowerCase()].filter(Boolean);
    if (!queries.length) return [];
    return customers
      .filter((c) => c.id !== "c1")
      .filter((c) =>
        queries.every((q) => c.name.toLowerCase().includes(q) || c.mobile.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [customers, custName, custMobile]);

  const exactMatch = useMemo(() => {
    const n = custName.trim().toLowerCase();
    const m = custMobile.trim();
    return customers.find(
      (c) => c.id !== "c1" && ((m && c.mobile === m) || (!m && n && c.name.toLowerCase() === n))
    );
  }, [customers, custName, custMobile]);

  const canCreate = (custName.trim() || custMobile.trim()) && !exactMatch;

  // Indian mobile: 10 digits, starts 6-9
  const mobileError = useMemo(() => {
    const m = custMobile.trim();
    if (!m) return "";
    if (!/^[6-9]\d{9}$/.test(m)) return "Enter a valid 10-digit mobile (starts 6-9)";
    return "";
  }, [custMobile]);

  const tableError = "";
  // Tables with an open (Pending) order — used for validation
  const pendingTables = useMemo(() => {
    const s = new Set<string>();
    orders.forEach((o) => {
      if (o.status === "Pending" && o.tableNo && o.id !== editId) s.add(o.tableNo);
    });
    return s;
  }, [orders, editId]);

  // Default: only Available tables; toggle off to show all. Current selection always shown.
  const availableTables = useMemo(
    () =>
      TABLE_NUMBERS.filter((t) => {
        if (t === tableNo) return true;
        const st = tableStatuses[t] ?? "Available";
        return onlyAvailable ? st === "Available" : true;
      }),
    [tableStatuses, tableNo, onlyAvailable]
  );

  const pickCustomer = (c: Customer) => {
    setCustName(c.name);
    setCustMobile(c.mobile);
    setCustOpen(false);
  };

  const saveCustomer = () => {
    const name = custName.trim();
    const mobile = custMobile.trim();
    if (!name && !mobile) return toast.error("Enter name or mobile");
    if (mobile && mobileError) return toast.error(mobileError);
    const existing = customers.find(
      (c) => c.id !== "c1" && ((mobile && c.mobile === mobile) || (!mobile && c.name.toLowerCase() === name.toLowerCase()))
    );
    if (existing) {
      setCustName(existing.name);
      setCustMobile(existing.mobile);
      return toast.success("Existing customer selected");
    }
    if (!name) return toast.error("Enter customer name");
    const nc: Customer = { id: uid(), name, mobile, visits: 0, totalSpend: 0, notes: "" };
    setCustomers((p) => [...p, nc]);
    setCustName(nc.name);
    setCustMobile(nc.mobile);
    toast.success("Customer added");
  };

  const add = (p: Product) => {
    if ((p.stock ?? Infinity) <= 0) return toast.error(`${p.name} out of stock`);
    setItems((prev) => {
      // Merge with existing plain line (no modifiers/instructions) — increment qty
      const idx = prev.findIndex(
        (i) => i.productId === p.id && !(i.modifiers?.length) && !i.instructions
      );
      if (idx >= 0) {
        return prev.map((i, k) => (k === idx ? { ...i, qty: i.qty + 1 } : i));
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, price: priceAfter(p), qty: 1, modifiers: [], instructions: "" },
      ];
    });
  };
  const setQty = (idx: number, qty: number) => {
    if (qty <= 0) return setItems((p) => p.filter((_, i) => i !== idx));
    setItems((p) => p.map((i, idx2) => (idx2 === idx ? { ...i, qty } : i)));
  };
  const updateItem = (idx: number, patch: Partial<OrderItem>) =>
    setItems((p) => p.map((i, idx2) => (idx2 === idx ? { ...i, ...patch } : i)));

  const checkout = (status: "Pending" | "Completed") => {
    if (items.length === 0) return toast.error("Add items first");
    if (mobileError) return toast.error(mobileError);
    if (tableError) return toast.error(tableError);

    // Validation: closing an order must not leave money outstanding unless it's a Due order
    if (status === "Completed" && payment !== "Due" && dueNum > 0) {
      return toast.error(`Cannot close order — ${inr(dueNum)} still unpaid. Use Due or collect full amount.`);
    }
    if (payment === "Split" && splitCashNum + splitOnlineNum <= 0) {
      return toast.error("Enter Cash and/or UPI amount for split payment");
    }
    // Validation: table must not already host another open order
    const t = tableNo.trim();
    if (t && status === "Pending" && pendingTables.has(t)) {
      return toast.error(`Table ${t} already has an open order`);
    }
    let cId: string | undefined;
    let cName = custName.trim() || "Walk-in";
    const cMobile = custMobile.trim();

    const editingOrder = editId ? orders.find((o) => o.id === editId) : undefined;
    const spendDelta = total - (editingOrder?.total ?? 0);

    if (custName.trim() || cMobile) {
      // find existing
      const existing = customers.find(
        (c) => c.id !== "c1" && (
          (cMobile && c.mobile === cMobile) ||
          (!cMobile && c.name.toLowerCase() === cName.toLowerCase())
        )
      );
      if (existing) {
        cId = existing.id;
        cName = existing.name;
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === cId
              ? {
                  ...c,
                  visits: editingOrder ? c.visits : c.visits + 1,
                  totalSpend: c.totalSpend + spendDelta,
                }
              : c
          )
        );
      } else if (cName !== "Walk-in") {
        const nc: Customer = { id: uid(), name: cName, mobile: cMobile, visits: 1, totalSpend: total, notes: "" };
        setCustomers((p) => [...p, nc]);
        cId = nc.id;
      }
    }

    // decrement stock only for new orders (edit doesn't re-decrement)
    if (!editingOrder) {
      setProducts((prev) =>
        prev.map((p) => {
          const sold = items.filter((i) => i.productId === p.id).reduce((s, i) => s + i.qty, 0);
          if (!sold || p.stock == null) return p;
          return { ...p, stock: Math.max(0, p.stock - sold) };
        })
      );
    }

    const order = {
      id: editingOrder?.id ?? nextOrderId(orders),
      date: editingOrder?.date ?? new Date().toISOString(),
      customerId: cId,
      customerName: cName,
      customerMobile: cMobile || undefined,
      items,
      subtotal,
      discount: discountNum || undefined,
      discountNote: discountNote.trim() || undefined,
      total,
      paidAmount: paidNum,
      payment,
      splitCash: payment === "Split" ? splitCashNum : undefined,
      splitOnline: payment === "Split" ? splitOnlineNum : undefined,
      splitDue: payment === "Split" ? splitDueNum : undefined,
      status,
      receiver: receiver || "Staff",
      tableNo: tableNo.trim() || undefined,
    };
    if (editingOrder) {
      setOrders((p) => p.map((o) => (o.id === order.id ? order : o)));
      toast.success(`Order ${order.id} updated`);
    } else {
      setOrders((p) => [...p, order]);
      toast.success(`Order ${order.id} ${status === "Completed" ? "completed" : "saved"}`);
    }

    // Auto table-status: Pending -> Occupied; Completed -> Available (only if no other open orders share the table)
    if (order.tableNo) {
      const tNo = order.tableNo;
      const othersOpen = orders.some(
        (o) => o.id !== order.id && o.status === "Pending" && o.tableNo === tNo
      );
      const next: TableStatus =
        status === "Completed" ? (othersOpen ? "Occupied" : "Available") : "Occupied";
      setTableStatuses((prev) => ({ ...prev, [tNo]: next }));
    }

    const printable = { ...order, tableStatus: order.tableNo ? (status === "Completed" ? "Available" : "Occupied") : undefined };
    setPostOrder(printable);
    setItems([]);
    setCustName("");
    setCustMobile("");
    setTableNo("");
    setReceiver("");
    setDiscount("");
    setDiscountNote("");
    setPaidAmount("");
    setSplitCash("");
    setSplitOnline("");
    if (editingOrder) navigate({ to: "/pos", search: {} });
  };

  const setCurrentTableStatus = (s: TableStatus) => {
    const t = tableNo.trim();
    if (!t) return toast.error("Pick a table first");
    if (s === "Available" && pendingTables.has(t)) {
      return toast.error(`Cannot free Table ${t} — an open order still uses it`);
    }
    setTableStatuses((prev) => ({ ...prev, [t]: s }));
    toast.success(`${t} → ${s}`);
  };


  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-4 max-w-[1400px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu..." className="pl-9" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {cats.map((c) => (
              <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)}>
                {c === "all" ? "All" : c}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {filtered.map((p) => {
            const out = (p.stock ?? Infinity) <= 0;
            return (
              <button
                key={p.id}
                onClick={() => add(p)}
                disabled={out}
                className="text-left rounded-xl border bg-card hover:border-primary hover:shadow-[var(--shadow-elevated)] transition overflow-hidden disabled:opacity-50"
              >
                <div className="aspect-[4/3] bg-muted flex items-center justify-center text-2xl relative">
                  {p.image ? <img src={p.image} alt={p.name} className="h-full w-full object-cover" /> : "🍽️"}
                  {p.stock != null && (
                    <span className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded ${out ? "bg-destructive text-destructive-foreground" : "bg-background/80"}`}>
                      {out ? "Out" : `${p.stock} left`}
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.category}</div>
                  <div className="text-sm font-bold text-primary mt-1">{inr(priceAfter(p))}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="p-4 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] flex flex-col gap-3">
        <div className="flex items-center justify-between shrink-0">
          <h3 className="font-semibold">Current Order</h3>
          <span className="text-xs text-muted-foreground">{items.length} items</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          {items.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">
              Tap items to add
            </div>
          )}

          {items.map((i, idx) => {
            const product = products.find((p) => p.id === i.productId);
            const presets = product?.modifiers ?? [];
            return (
              <div key={idx} className="rounded-lg border p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{inr(i.price)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(idx, i.qty - 1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center text-sm font-semibold">{i.qty}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(idx, i.qty + 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <div className="w-14 text-right text-sm font-semibold">{inr(i.price * i.qty)}</div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQty(idx, 0)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>

                {(i.modifiers?.length || i.instructions) && (
                  <div className="flex flex-wrap gap-1">
                    {i.modifiers?.map((m) => (
                      <span key={m} className="text-[10px] bg-accent text-accent-foreground px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                        {m}
                        <button onClick={() => updateItem(idx, { modifiers: i.modifiers!.filter((x) => x !== m) })}>
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    {i.instructions && (
                      <span className="text-[10px] italic text-muted-foreground">“{i.instructions}”</span>
                    )}
                  </div>
                )}

                <Popover open={modIdx === idx} onOpenChange={(o) => setModIdx(o ? idx : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                      <MessageSquarePlus className="h-3 w-3" /> Add note / modifier
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-2">
                    {presets.length > 0 && (
                      <div>
                        <Label className="text-xs">Preset modifiers</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {presets.map((m) => {
                            const on = i.modifiers?.includes(m);
                            return (
                              <Button
                                key={m}
                                size="sm"
                                variant={on ? "default" : "outline"}
                                className="h-6 text-[11px] px-2"
                                onClick={() =>
                                  updateItem(idx, {
                                    modifiers: on
                                      ? i.modifiers!.filter((x) => x !== m)
                                      : [...(i.modifiers ?? []), m],
                                  })
                                }
                              >
                                {m}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Special instructions</Label>
                      <Textarea
                        value={i.instructions || ""}
                        onChange={(e) => updateItem(idx, { instructions: e.target.value })}
                        placeholder="e.g. No onion, extra spicy"
                        className="text-sm"
                        rows={2}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}

          <div className="border-t pt-3 space-y-2">

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Customer</Label>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={saveCustomer}>
                <Plus className="h-3 w-3" /> Add Customer
              </Button>
            </div>
            <Popover open={custOpen && (suggestions.length > 0 || !!canCreate)} onOpenChange={setCustOpen}>
              <div className="grid grid-cols-2 gap-2 relative">
                <PopoverAnchor asChild>
                  <Input
                    placeholder="Customer name"
                    value={custName}
                    onChange={(e) => { setCustName(e.target.value); setCustOpen(true); }}
                    onFocus={() => setCustOpen(true)}
                  />
                </PopoverAnchor>
                <Input
                  placeholder="Mobile (10 digits)"
                  inputMode="numeric"
                  value={custMobile}
                  onChange={(e) => { setCustMobile(e.target.value.replace(/\D/g, "").slice(0, 10)); setCustOpen(true); }}
                  onFocus={() => setCustOpen(true)}
                  aria-invalid={!!mobileError}
                  className={mobileError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
              </div>
              <PopoverContent className="w-80 p-1" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickCustomer(c)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.mobile || "—"} · {c.visits} visits</div>
                  </button>
                ))}
                {suggestions.length === 0 && canCreate && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches found</div>
                )}
                {canCreate && (
                  <button
                    onClick={() => { saveCustomer(); setCustOpen(false); }}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm border-t mt-1 flex items-center gap-2 text-primary font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create new: {custName.trim() || "Guest"}{custMobile.trim() ? ` (${custMobile.trim()})` : ""}
                  </button>
                )}
              </PopoverContent>
            </Popover>
            {mobileError && (
              <p className="text-xs text-destructive mt-1">{mobileError}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Payment</Label>
              <Select value={payment} onValueChange={(v) => { setPayment(v as Payment); setPaidAmount(""); }}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${PAY_STYLES[payment]?.bg}`} />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />Cash</span></SelectItem>
                  <SelectItem value="Online"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />UPI / Online</span></SelectItem>
                  <SelectItem value="Due"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Due</span></SelectItem>
                  <SelectItem value="Split"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-purple-500" />Split</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Staff</Label>
              {staff.length > 0 ? (
                <Select value={receiver} onValueChange={setReceiver}>
                  <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Receiver" />
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Table No.</Label>
              <button
                type="button"
                onClick={() => setOnlyAvailable((v) => !v)}
                className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                title="Toggle table filter"
              >
                <Filter className="h-3 w-3" />
                {onlyAvailable ? "Available only" : "All tables"}
              </button>
            </div>
            <Select value={tableNo || "__none"} onValueChange={(v) => setTableNo(v === "__none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Takeaway / no table" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Takeaway (no table)</SelectItem>
                {availableTables.map((t) => {
                  const st = tableStatuses[t] ?? "Available";
                  return (
                    <SelectItem key={t} value={t}>
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${st === "Available" ? "bg-green-500" : st === "Occupied" ? "bg-red-500" : "bg-yellow-500"}`} />
                        {t} <span className="text-xs text-muted-foreground">· {st}</span>
                      </span>
                    </SelectItem>
                  );
                })}
                {availableTables.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No tables available</div>
                )}
              </SelectContent>
            </Select>
          </div>

          {payment === "Split" && (
            <div className="rounded-lg border bg-muted/30 p-2 space-y-2">
              <div className="text-xs font-semibold">Split Payment</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Cash Amount</Label>
                  <Input
                    type="number" inputMode="numeric" min={0}
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs">UPI Amount</Label>
                  <Input
                    type="number" inputMode="numeric" min={0}
                    value={splitOnline}
                    onChange={(e) => setSplitOnline(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Due Amount (auto)</Label>
                <Input value={inr(splitDueNum)} readOnly className="bg-background" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Discount (₹)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Offer / Note</Label>
              <Input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="e.g. Festive 10%" />
            </div>
          </div>

          {payment !== "Split" && (
            <div>
              <Label className="text-xs">Paid amount (₹)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={String(payment === "Due" ? 0 : total)}
              />
              <div className="flex items-center justify-between mt-1 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-semibold ${dueNum <= 0 ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
                  {dueNum <= 0 ? "PAID" : "UNPAID"}
                </span>
                {dueNum > 0 && <span className="text-destructive">Due {inr(dueNum)}</span>}
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="shrink-0 space-y-2">
          <div className="border-t pt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Subtotal</span><span>{inr(subtotal)}</span>
            </div>
            {discountNum > 0 && (
              <div className="flex items-center justify-between text-green-600 dark:text-green-400">
                <span>Discount{discountNote ? ` (${discountNote})` : ""}</span><span>− {inr(discountNum)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t">
              <span className="text-muted-foreground">Final Total</span>
              <span className="text-2xl font-bold text-primary">{inr(total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Paid</span><span>{inr(paidNum)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Remaining</span>
              <span className={dueNum > 0 ? "text-destructive font-semibold" : "text-green-600 font-semibold"}>{inr(dueNum)}</span>
            </div>
            {total > 0 && dueNum <= 0 && (
              <div className="text-center">
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white">✓ PAID</span>
              </div>
            )}
          </div>


          {/* MANDATORY: pick one — Occupy Table (Pending) OR Close Order (Completed) */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              className="w-full"
              disabled={items.length === 0 || !tableNo}
              onClick={() => checkout("Pending")}
              title={!tableNo ? "Select a table first" : "Place order and occupy table"}
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Occupy Table
            </Button>
            <Button
              className="w-full"
              disabled={items.length === 0}
              onClick={() => checkout("Completed")}
            >
              <span className="h-2 w-2 rounded-full bg-green-500" /> Close Order
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
                Table Status {tableNo ? `· ${tableStatuses[tableNo] ?? "Available"}` : ""} <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{tableNo || "Pick a table first"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!tableNo} onClick={() => setCurrentTableStatus("Available")}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> Available
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!tableNo} onClick={() => setCurrentTableStatus("Occupied")}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> Occupied
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!tableNo} onClick={() => setCurrentTableStatus("Reserved")}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow-500" /> Reserved
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {editId && (
            <Button variant="ghost" className="w-full" onClick={() => navigate({ to: "/pos", search: {} })}>
              Cancel edit
            </Button>
          )}
        </div>
      </Card>

      {/* AFTER PLACE ORDER: must choose Print Bill or Save Order */}
      <Dialog open={!!postOrder} onOpenChange={(o) => { if (!o) setPostOrder(null); }}>
        <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Order placed — {postOrder?.id}</DialogTitle>
            <DialogDescription>
              {postOrder?.tableNo ? `Table ${postOrder.tableNo} · ` : "Takeaway · "}
              Total {postOrder ? inr(postOrder.total) : ""}. Choose one to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" onClick={() => setPostOrder(null)}>
              Save Order
            </Button>
            <Button
              onClick={() => {
                if (postOrder) printBill(postOrder);
                setPostOrder(null);
              }}
            >
              <Printer className="h-4 w-4" /> Print Bill
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function printBill(order: {
  id: string;
  date: string;
  customerName: string;
  customerMobile?: string;
  items: OrderItem[];
  subtotal?: number;
  discount?: number;
  discountNote?: string;
  total: number;
  paidAmount?: number;
  payment: string;
  splitCash?: number;
  splitOnline?: number;
  splitDue?: number;
  receiver: string;
  tableNo?: string;
  tableStatus?: string;
}) {
  const w = window.open("", "PRINT", "width=400,height=600");
  if (!w) return;
  const rows = order.items
    .map((i) => {
      const extras = [
        ...(i.modifiers ?? []),
        ...(i.instructions ? [`Note: ${i.instructions}`] : []),
      ];
      const sub = extras.length ? `<div style="font-size:11px;color:#555;padding-left:6px">↳ ${extras.join(", ")}</div>` : "";
      return `<tr><td>${i.name} x${i.qty}${sub}</td><td style="text-align:right;vertical-align:top">${inr(i.price * i.qty)}</td></tr>`;
    })
    .join("");
  w.document.write(`
    <html><head><title>${order.id}</title>
    <style>
      @page { size: 58mm auto; margin: 2mm; }
      body{font-family:monospace;padding:2px;font-size:12px;width:54mm;margin:0 auto;color:#000}
      .cafe{margin:0;text-align:center;font-size:18px;font-weight:bold;letter-spacing:1px}
      .tagline{text-align:center;font-size:10px;margin-bottom:4px}
      .box{border:1px solid #000;padding:4px 6px;margin:4px 0}
      .row{display:flex;justify-content:space-between;gap:6px}
      .center{text-align:center}
      .bold{font-weight:bold}
      table{width:100%;border-collapse:collapse}
      td{padding:2px 0;vertical-align:top}
      hr{border:none;border-top:1px dashed #000;margin:4px 0}
      .tot{font-weight:bold;font-size:15px}
      @media print { body { padding:0 } }
    </style>
    </head><body>
    <h2 class="cafe">Lucifer Cafe</h2>
    <div class="tagline">${new Date(order.date).toLocaleString("en-IN")}</div>
    <div class="box row bold">
      <span>ORDER</span>
      <span>${order.tableNo ? `TABLE ${order.tableNo}` : "TAKEAWAY"}</span>
    </div>
    <div class="box">
      <div>Customer : ${order.customerName}</div>
      ${order.customerMobile ? `<div>Contact&nbsp;&nbsp;: ${order.customerMobile}</div>` : ""}
      <div>Order ID : ${order.id}</div>
      <div>Date&nbsp;&nbsp;&nbsp;&nbsp;: ${new Date(order.date).toLocaleDateString("en-IN")}</div>
    </div>
    <div class="box">
      <div class="bold center" style="border-bottom:1px dashed #000;padding-bottom:2px;margin-bottom:3px">ITEMS</div>
      <table>${rows}</table>
    </div>
    <div class="box">
      <table>
        <tr><td>Subtotal</td><td style="text-align:right">${inr(order.subtotal ?? order.total)}</td></tr>
        ${order.discount ? `<tr><td>Discount${order.discountNote ? ` (${order.discountNote})` : ""}</td><td style="text-align:right">− ${inr(order.discount)}</td></tr>` : ""}
        <tr><td class="tot">TOTAL</td><td class="tot" style="text-align:right">${inr(order.total)}</td></tr>
      </table>
    </div>
    <div class="box">
      <div class="center bold">Payment : ${order.payment === "Online" ? "UPI" : order.payment}</div>
      ${order.payment === "Split" ? `<table style="margin-top:3px">
        <tr><td>Cash</td><td style="text-align:right">${inr(order.splitCash ?? 0)}</td></tr>
        <tr><td>UPI</td><td style="text-align:right">${inr(order.splitOnline ?? 0)}</td></tr>
        ${(order.splitDue ?? 0) > 0 ? `<tr><td style="color:#c00">Due</td><td style="text-align:right;color:#c00">${inr(order.splitDue ?? 0)}</td></tr>` : ""}
      </table>` : ""}
      ${order.paidAmount != null && order.payment !== "Split" ? `<table style="margin-top:3px">
        <tr><td>Paid</td><td style="text-align:right">${inr(order.paidAmount)}</td></tr>
        ${order.total - order.paidAmount > 0 ? `<tr><td style="color:#c00;font-weight:bold">Due</td><td style="text-align:right;color:#c00;font-weight:bold">${inr(order.total - order.paidAmount)}</td></tr>` : ""}
      </table>` : ""}
    </div>
    <div class="center" style="margin-top:4px">Thank you! Visit again 🙏</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
    </body></html>
  `);
  w.document.close();
}
