"use client";

import { useEffect, useState } from "react";
import { User, Search, Check, Loader2, UserPlus } from "lucide-react";

import { useCustomerSearch, useCreateCustomer } from "@/hooks/use-customers";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Customer } from "@/types";

interface CustomerSearchProps {
  value: Customer | undefined;
  onChange: (customer: Customer | undefined) => void;
}

export function CustomerSearch({ value, onChange }: CustomerSearchProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState(false);

  // 300ms debounce so we don't fire the (uncached) search on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(id);
  }, [term]);

  const { data: results, isFetching } = useCustomerSearch(debounced);

  const select = (customer: Customer | undefined) => {
    onChange(customer);
    setOpen(false);
    setTerm("");
    setDebounced("");
    setAdding(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[12rem] gap-2">
          <User className="h-4 w-4" />
          <span className="truncate">{value ? value.name : "Walk-In"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>
            Search by name or mobile, or add a new customer.
          </DialogDescription>
        </DialogHeader>

        {adding ? (
          <AddCustomerForm onCancel={() => setAdding(false)} onCreated={select} />
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Name or mobile…"
                className="pl-8"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto">
              {isFetching && (
                <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              )}
              {!isFetching &&
                debounced.length >= 2 &&
                (results?.length ?? 0) === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">
                    No matches. Add a new customer below.
                  </p>
                )}
              {results?.map((c) => (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => select(c)}
                  className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.mobile} · {c.visits} visits
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.totalDue > 0 && (
                      <span className="text-xs font-medium text-destructive">
                        Due {inr(c.totalDue)}
                      </span>
                    )}
                    {value?._id === c._id && <Check className="h-4 w-4" />}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => select(undefined)}
              >
                Walk-In
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => setAdding(true)}
              >
                <UserPlus className="h-4 w-4" /> New
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddCustomerForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (customer: Customer) => void;
}) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const createCustomer = useCreateCustomer();

  const submit = async () => {
    const created = await createCustomer.mutateAsync({
      name: name.trim(),
      mobile: mobile.trim(),
      notes: "Regular",
    });
    onCreated(created);
  };

  const valid = name.trim().length > 0 && mobile.trim().length >= 10;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="new-customer-name">Name</Label>
        <Input
          id="new-customer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-customer-mobile">Mobile</Label>
        <Input
          id="new-customer-mobile"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          inputMode="numeric"
          placeholder="10-digit number"
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={!valid || createCustomer.isPending}
          onClick={submit}
        >
          {createCustomer.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Add customer"
          )}
        </Button>
      </div>
    </div>
  );
}
