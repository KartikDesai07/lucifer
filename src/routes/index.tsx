import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOrders, useCustomers, useProducts, inr, PAY_STYLES, isOrderPaid, orderDue } from "@/lib/storage";
import { TrendingUp, ShoppingBag, Users, IndianRupee, Plus, Pencil, Check, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Lucifer Cafe POS" },
      { name: "description", content: "Today's sales, top products and recent orders at a glance." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [orders, setOrders] = useOrders();
  const [customers] = useCustomers();
  const [products] = useProducts();

  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => o.date.slice(0, 10) === today);
  const todaySales = todayOrders.reduce((s, o) => s + o.total, 0);
  const cash = todayOrders.filter((o) => o.payment === "Cash").reduce((s, o) => s + o.total, 0);
  const online = todaySales - cash;

  // Today table-wise breakdown (dine-in only)
  const tableBreakdown = todayOrders
    .filter((o) => o.tableNo)
    .reduce<Record<string, { count: number; sum: number }>>((acc, o) => {
      const k = o.tableNo!;
      acc[k] = acc[k] || { count: 0, sum: 0 };
      acc[k].count += 1;
      acc[k].sum += o.total;
      return acc;
    }, {});
  const tableRows = Object.entries(tableBreakdown).sort((a, b) => b[1].sum - a[1].sum);
  const dineinTotal = tableRows.reduce((s, [, v]) => s + v.sum, 0);
  const takeawayTotal = todaySales - dineinTotal;

  const productSales: Record<string, number> = {};
  orders.forEach((o) =>
    o.items.forEach((i) => {
      productSales[i.name] = (productSales[i.name] || 0) + i.qty;
    })
  );
  const top = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const recent = [...orders].reverse().slice(0, 6);

  const stats = [
    { label: "Today Sales", value: inr(todaySales), icon: IndianRupee, accent: true },
    { label: "Today Orders", value: todayOrders.length, icon: ShoppingBag },
    { label: "Customers", value: customers.length, icon: Users },
    { label: "Menu Items", value: products.length, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Welcome back 👋</h2>
          <p className="text-sm text-muted-foreground">Here's what's happening at your café today.</p>
        </div>
        <Button asChild size="lg" className="shadow-[var(--shadow-elevated)]">
          <Link to="/pos"><Plus className="h-4 w-4" /> New Order</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={`p-4 ${s.accent ? "bg-[image:var(--gradient-primary)] text-primary-foreground border-0" : ""}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-xs ${s.accent ? "opacity-80" : "text-muted-foreground"}`}>{s.label}</div>
                <div className="text-2xl font-bold mt-1">{s.value}</div>
              </div>
              <s.icon className={`h-5 w-5 ${s.accent ? "opacity-80" : "text-primary"}`} />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Orders</h3>
            <Link to="/pos" className="text-xs text-primary hover:underline">New →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No orders yet. Create your first order from the POS screen.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left text-xs uppercase tracking-wide">
                    <th className="py-2 pr-3 font-medium">Order No</th>
                    <th className="py-2 pr-3 font-medium">Table No</th>
                    <th className="py-2 pr-3 font-medium">Payment Status</th>
                    <th className="py-2 pr-3 font-medium">Payment Mode</th>
                    <th className="py-2 pr-3 font-medium text-right">Amount</th>
                    <th className="py-2 pr-3 font-medium">Order Status</th>
                    <th className="py-2 pl-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.map((o) => {
                    const pay = PAY_STYLES[o.payment] ?? PAY_STYLES.Cash;
                    const paid = isOrderPaid(o);
                    return (
                      <tr key={o.id} className="hover:bg-muted/50 transition-colors">
                        <td className="py-3 pr-3 font-medium whitespace-nowrap">{o.id}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          {o.tableNo ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                              {o.tableNo}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${paid ? "bg-green-500" : "bg-red-500"}`}>
                            {paid ? "Paid" : "Unpaid"}
                          </span>
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pay.bg} ${pay.text}`}>
                            {pay.label}
                          </span>
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap text-right font-semibold">{inr(o.total)}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              o.status === "Completed"
                                ? "bg-accent text-accent-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="py-3 pl-3 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            {o.status === "Pending" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-[11px] px-2"
                                onClick={() => setOrders((p) => p.map((x) => x.id === o.id ? { ...x, status: "Completed" } : x))}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
                              <Link to="/pos" search={{ edit: o.id }}><Pencil className="h-3.5 w-3.5" /></Link>
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
                              <Link to="/pos" search={{ reorder: o.id }}><RefreshCw className="h-3.5 w-3.5" /></Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-3">Top Selling</h3>
            {top.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data yet.</div>
            ) : (
              <div className="space-y-2">
                {top.map(([name, qty]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="truncate">{name}</span>
                    <span className="font-semibold text-primary">{qty}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold mb-3">Payment Split (today)</h3>
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="w-16 text-muted-foreground">Cash</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${todaySales ? (cash / todaySales) * 100 : 0}%` }}
                />
              </div>
              <span className="font-medium">{inr(cash)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">Online</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-foreground"
                  style={{ width: `${todaySales ? (online / todaySales) * 100 : 0}%` }}
                />
              </div>
              <span className="font-medium">{inr(online)}</span>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Table Sales (today)</h3>
            </div>
            <div className="text-[10px] text-muted-foreground mb-2">
              Dine-in {inr(dineinTotal)} · Takeaway {inr(takeawayTotal)}
            </div>
            {tableRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No dine-in orders yet.</div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {tableRows.map(([t, v]) => (
                  <div key={t} className="flex items-center justify-between text-sm gap-2">
                    <span className="font-medium">{t}</span>
                    <span className="text-xs text-muted-foreground flex-1 text-right">{v.count} ord</span>
                    <span className="font-semibold text-primary w-20 text-right">{inr(v.sum)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
