"use client";

import { Plus, Search, Users, Loader2 } from "lucide-react";

import { CUSTOMER_SEARCH_MIN_CHARS } from "@/hooks/use-customers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { BRAND_CONTROL_CLASS, BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";

const LIST_SKELETON_ROWS = 6;

interface CustomerListStatusProps {
  hasRows: boolean;
  loading: boolean;
  offlineUnloaded: boolean;
  refreshFailed: boolean;
  noCustomers: boolean;
  belowSearchFloor: boolean;
  searching: boolean;
  searchOffline: boolean;
  searchFailed: boolean;
  onAdd: () => void;
  onRetry: () => void;
  onClearSearch: () => void;
}

// One ordered decision for what the panel says, so a newly-reachable state
// cannot fall through into a wrong one. `null` means "render the list".
// Same branch order and copy as the IIFE this was extracted from in
// customers/page.tsx — the props are the primitive booleans page.tsx already
// computes, so every pinned expression stays in page.tsx verbatim.
export function CustomerListStatus({
  hasRows,
  loading,
  offlineUnloaded,
  refreshFailed,
  noCustomers,
  belowSearchFloor,
  searching,
  searchOffline,
  searchFailed,
  onAdd,
  onRetry,
  onClearSearch,
}: CustomerListStatusProps) {
  // Having rows to show beats every status: a search that worked must not be
  // hidden behind a list that is still loading or failed to refresh.
  if (hasRows) return null;
  if (loading) {
    return (
      <div className={cn("space-y-2 rounded-lg border p-4", BRAND_PANEL_CLASS)}>
        {Array.from({ length: LIST_SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  // A parked (offline) query reports isLoading AND isError false with no data,
  // so without this the page tells a cafe with a full customer book that it
  // has "No customers yet" and offers to add one.
  if (offlineUnloaded) {
    return (
      <p className="text-sm text-muted-foreground">
        You appear to be offline. Customers will load when the connection is
        back.
      </p>
    );
  }
  // isLoadingError, not isError: a failed REFRESH while cached rows are still
  // in hand must not throw away a list the operator can keep working from.
  if (refreshFailed) {
    return (
      <ErrorState
        title="Couldn't load customers"
        description="Check the internet connection, then try again."
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }
  if (noCustomers) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8" />}
        title="No customers yet"
        description="Customers are added here or automatically from the POS."
        action={
          <Button onClick={onAdd} className={cn("mt-2", BRAND_CONTROL_CLASS)}>
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
      <div className={cn("flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground", BRAND_PANEL_CLASS)}>
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
  if (searchFailed) {
    return (
      <p className="text-sm text-destructive">
        Search failed. Check the connection and try again.
      </p>
    );
  }
  return (
    <EmptyState
      icon={<Search className="h-8 w-8" />}
      title="No matches"
      description="No customer matches your search."
      action={
        <Button
          type="button"
          variant="outline"
          className={cn("mt-2", BRAND_CONTROL_CLASS)}
          onClick={onClearSearch}
        >
          Clear search
        </Button>
      }
    />
  );
}
