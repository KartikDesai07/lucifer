"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, Users, History } from "lucide-react";

import { useCustomers, useDeleteCustomer } from "@/hooks/use-customers";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CustomerFormSheet } from "@/components/customers/CustomerFormSheet";
import { CustomerHistoryDialog } from "@/components/customers/CustomerHistoryDialog";
import type { Customer } from "@/types";

export default function CustomersPage() {
  const customers = useCustomers();
  const deleteCustomer = useDeleteCustomer();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [history, setHistory] = useState<Customer | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.data ?? [];
    return (customers.data ?? []).filter(
      (c) => c.name.toLowerCase().includes(q) || c.mobile.includes(q),
    );
  }, [customers.data, search]);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCustomer.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error (e.g. blocked when dues outstanding)
    }
  };

  const hasCustomers = (customers.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Customers</h2>
          <p className="text-sm text-muted-foreground">
            Track visits, spending, and outstanding dues.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add customer
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or mobile…"
          className="pl-8"
        />
      </div>

      {customers.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : customers.isError ? (
        <p className="text-sm text-destructive">
          Failed to load customers. Refresh to retry.
        </p>
      ) : !hasCustomers ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No customers yet"
          description="Customers are added here or automatically from the POS."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> Add customer
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description="No customer matches your search."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer._id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.mobile}
                  </TableCell>
                  <TableCell className="text-right">{customer.visits}</TableCell>
                  <TableCell className="text-right">
                    {inr(customer.totalSpend)}
                  </TableCell>
                  <TableCell className="text-right">
                    {customer.totalDue > 0 ? (
                      <Badge variant="destructive">
                        {inr(customer.totalDue)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={customer.notes === "VIP" ? "default" : "secondary"}
                    >
                      {customer.notes}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setHistory(customer)}
                        aria-label="Order history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(customer)}
                        aria-label="Edit customer"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(customer)}
                        aria-label="Delete customer"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CustomerFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editing}
      />

      <CustomerHistoryDialog
        customer={history}
        onOpenChange={(o) => !o && setHistory(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete customer?"
        description={`"${deleting?.name}" will be permanently removed. Customers with outstanding dues cannot be deleted.`}
        confirmLabel="Delete"
        isLoading={deleteCustomer.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
