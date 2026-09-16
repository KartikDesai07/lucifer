"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import {
  useCustomers,
  useDeleteCustomer,
  useCustomerSearch,
  CUSTOMER_SEARCH_MIN_CHARS,
} from "@/hooks/use-customers";
import { useAuth } from "@/hooks/use-auth";
import { CUSTOMER_SEARCH_LIMIT } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CustomerFormSheet } from "@/components/customers/CustomerFormSheet";
import { CustomerHistoryDialog } from "@/components/customers/CustomerHistoryDialog";
import { ReceivePaymentDialog } from "@/components/customers/ReceivePaymentDialog";
import { CustomerRowCard } from "@/components/customers/CustomerRowCard";
import { CustomerTable } from "@/components/customers/CustomerTable";
import { CustomerListStatus } from "@/components/customers/CustomerListStatus";
import type { Customer } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;

// Union by _id. Local rows set the ORDER — they are already name-sorted and are
// what the operator is looking at, so an arriving remote row never reshuffles
// rows under a moving finger. But the remote copy wins on VALUES, because it was
// just fetched while the cached list can be minutes stale (nothing refetches it
// while the page stays mounted). The stale field that matters is `totalDue`: it
// decides whether the Receive-payment button appears at all, so keeping the
// local copy can hide a real due, or seed a collection dialog with an amount
// that is short of what is owed.
function mergeById(local: Customer[], remote: Customer[]): Customer[] {
  if (remote.length === 0) return local;
  const fresh = new Map(remote.map((c) => [c._id, c]));
  const merged = local.map((c) => fresh.get(c._id) ?? c);
  const seen = new Set(local.map((c) => c._id));
  for (const c of remote) if (!seen.has(c._id)) merged.push(c);
  return merged;
}

export default function CustomersPage() {
  const customers = useCustomers();
  const deleteCustomer = useDeleteCustomer();
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [history, setHistory] = useState<Customer | null>(null);
  const [receiving, setReceiving] = useState<Customer | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  // An admin's list holds REAL numbers, so the local filter is complete and
  // this page behaves exactly as it did before masking — no debounce, no
  // network, instant results.
  //
  // Staff hold MASKED numbers, where filtering them locally is worse than
  // useless: "98765" matches every customer sharing that prefix, and any digit
  // past the 5th matches nobody. So for staff the NAME filter stays local and
  // the NUMBER lookup goes to the server, which still matches the real value.
  const localMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.data ?? [];
    return (customers.data ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (isAdmin && c.mobile.includes(q)),
    );
  }, [customers.data, search, isAdmin]);

  const remote = useCustomerSearch(isAdmin ? "" : debounced);
  const query = search.trim();
  // Remote rows count only once the debounce has caught up with what is on
  // screen. Otherwise the table fills with confident, identically-masked rows
  // answering a PREVIOUS query while the operator reads the current one — and a
  // tap there opens the wrong customer's dues. Compared TRIMMED, because that is
  // what the query key uses; a stray trailing space is the same search.
  const searchSettled = debounced.trim() === query;
  const remoteRows = !isAdmin && searchSettled ? (remote.data ?? []) : [];
  const filtered = mergeById(localMatches, remoteRows);

  // Three ways a staff search has NOT answered "nobody", each of which the page
  // used to render as the definitive "No matches" — the single most expensive
  // wrong answer here, because it sends the operator off to create a duplicate
  // or to write off a due that is genuinely owed.
  const staffSearching = !isAdmin && query.length > 0;
  // 1. Below the hook's own floor, the request is never sent at all.
  const belowSearchFloor =
    staffSearching && query.length < CUSTOMER_SEARCH_MIN_CHARS;
  // 2. Offline, TanStack parks the query as `paused` — which reports isLoading
  //    AND isError false with no data, i.e. indistinguishable from an empty
  //    result unless isPaused is read explicitly.
  const searchOffline = staffSearching && searchSettled && remote.isPaused;
  const searching =
    staffSearching &&
    !belowSearchFloor &&
    !searchOffline &&
    (!searchSettled || remote.isFetching);
  // 3. The server caps a search at CUSTOMER_SEARCH_LIMIT rows. Staff scanning
  //    identically-masked numbers cannot tell a capped list from a complete one.
  const truncated = remoteRows.length >= CUSTOMER_SEARCH_LIMIT;

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
  const hasRows = filtered.length > 0;
  const offlineUnloaded = customers.isPaused && !hasCustomers;
  const noCustomers = !hasCustomers && !query;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Track visits, spending, and outstanding dues."
        actions={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add customer
          </Button>
        }
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or mobile…"
          className="pl-8"
        />
      </div>

      <CustomerListStatus
        hasRows={hasRows}
        loading={customers.isLoading}
        offlineUnloaded={offlineUnloaded}
        refreshFailed={customers.isLoadingError}
        noCustomers={noCustomers}
        belowSearchFloor={belowSearchFloor}
        searching={searching}
        searchOffline={searchOffline}
        searchFailed={remote.isError}
        onAdd={openAdd}
      />
      {hasRows && (
        <>
          {truncated && (
            // Without this, a capped list of look-alike masked numbers reads as
            // a complete answer.
            <p className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              Showing the first {CUSTOMER_SEARCH_LIMIT} matches. Type more of the
              name or number to narrow it down.
            </p>
          )}

          <div className="hidden md:block">
            <CustomerTable
              customers={filtered}
              isAdmin={isAdmin}
              onReceivePayment={setReceiving}
              onHistory={setHistory}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((customer) => (
              <CustomerRowCard
                key={customer._id}
                customer={customer}
                isAdmin={isAdmin}
                onReceivePayment={setReceiving}
                onHistory={setHistory}
                onEdit={openEdit}
                onDelete={setDeleting}
              />
            ))}
          </div>
        </>
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

      <ReceivePaymentDialog
        customer={receiving}
        onOpenChange={(o) => !o && setReceiving(null)}
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
