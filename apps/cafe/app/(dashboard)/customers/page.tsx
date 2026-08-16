"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Users,
  History,
  Wallet,
  Loader2,
} from "lucide-react";

import {
  useCustomers,
  useDeleteCustomer,
  useCustomerSearch,
  CUSTOMER_SEARCH_MIN_CHARS,
} from "@/hooks/use-customers";
import { useAuth } from "@/hooks/use-auth";
import { CUSTOMER_SEARCH_LIMIT } from "@/lib/constants";
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
import { ReceivePaymentDialog } from "@/components/customers/ReceivePaymentDialog";
import type { Customer } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;
const LIST_SKELETON_ROWS = 6;

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

  // One ordered decision for what the panel says, so a newly-reachable state
  // cannot fall through into a wrong one. `null` means "render the table".
  const statusPanel = (() => {
    // Having rows to show beats every status: a search that worked must not be
    // hidden behind a list that is still loading or failed to refresh.
    if (filtered.length > 0) return null;
    if (customers.isLoading) {
      return (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: LIST_SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }
    // A parked (offline) query reports isLoading AND isError false with no data,
    // so without this the page tells a cafe with a full customer book that it
    // has "No customers yet" and offers to add one.
    if (customers.isPaused && !hasCustomers) {
      return (
        <p className="text-sm text-muted-foreground">
          You appear to be offline. Customers will load when the connection is
          back.
        </p>
      );
    }
    // isLoadingError, not isError: a failed REFRESH while cached rows are still
    // in hand must not throw away a list the operator can keep working from.
    if (customers.isLoadingError) {
      return (
        <p className="text-sm text-destructive">
          Failed to load customers. Refresh to retry.
        </p>
      );
    }
    if (!hasCustomers && !query) {
      return (
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
      );
    }
    if (belowSearchFloor) {
      return (
        <p className="text-sm text-muted-foreground">
          Keep typing — search starts at {CUSTOMER_SEARCH_MIN_CHARS} characters.
        </p>
      );
    }
    if (searching) {
      return (
        <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </div>
      );
    }
    // Offline and a failed request are both "we did not find out", never "this
    // customer does not exist" — that answer is what sends an operator off to
    // create a duplicate, or to write off a due that is genuinely owed.
    if (searchOffline) {
      return (
        <p className="text-sm text-destructive">
          You appear to be offline, so this could not be checked against the
          customer list.
        </p>
      );
    }
    if (remote.isError) {
      return (
        <p className="text-sm text-destructive">
          Search failed. Check the connection and try again.
        </p>
      );
    }
    return (
      <EmptyState
        title="No matches"
        description="No customer matches your search."
      />
    );
  })();

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

      {statusPanel ?? (
        <div className="rounded-lg border">
          {truncated && (
            // Without this, a capped list of look-alike masked numbers reads as
            // a complete answer.
            <p className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              Showing the first {CUSTOMER_SEARCH_LIMIT} matches. Type more of the
              name or number to narrow it down.
            </p>
          )}
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
                      {customer.totalDue > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setReceiving(customer)}
                          aria-label="Receive payment"
                        >
                          <Wallet className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
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
                      {/* Admin only — the route enforces it too (403). Showing
                          it to staff would offer an action that always fails. */}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(customer)}
                          aria-label="Delete customer"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
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
