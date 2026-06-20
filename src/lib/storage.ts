import { useEffect, useState, useCallback } from "react";

export type Category = string;

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  discount: number; // percentage
  stock?: number;
  image?: string; // data url
  modifiers?: string[]; // preset modifier options e.g. ["Less Sugar","Extra Cheese"]
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  notes: "Regular" | "VIP" | "";
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
  instructions?: string;
}

export type PaymentMode = "Cash" | "Online" | "Due" | "Split";

export type TableStatus = "Available" | "Occupied" | "Reserved";
export const TABLE_NUMBERS = ["T-1","T-2","T-3","T-4","T-5","T-6","T-7","T-8"] as const;

export interface Order {
  id: string;
  date: string; // ISO
  customerId?: string;
  customerName: string;
  customerMobile?: string;
  items: OrderItem[];
  subtotal?: number; // sum of items before discount
  discount?: number; // flat ₹ off
  discountNote?: string;
  total: number; // after discount
  paidAmount?: number; // amount actually paid (default total if Cash/Online, 0 for Due)
  payment: PaymentMode | "Credit"; // Credit kept for legacy data
  splitCash?: number;
  splitOnline?: number;
  splitDue?: number;
  status: "Pending" | "Completed";
  receiver: string;
  tableNo?: string;
}

export const orderPaid = (o: Order): number =>
  o.paidAmount ?? (o.payment === "Due" ? 0 : o.total);
export const orderDue = (o: Order): number => Math.max(0, o.total - orderPaid(o));
export const isOrderPaid = (o: Order): boolean => orderDue(o) <= 0;

export const PAY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  Cash:   { bg: "bg-yellow-400",  text: "text-yellow-950",  label: "Cash" },
  Online: { bg: "bg-blue-500",    text: "text-white",       label: "Online" },
  Due:    { bg: "bg-red-500",     text: "text-white",       label: "Due" },
  Split:  { bg: "bg-purple-500",  text: "text-white",       label: "Split" },
  Credit: { bg: "bg-orange-400",  text: "text-orange-950",  label: "Credit" },
};

export interface Staff {
  id: string;
  name: string;
  mobile: string;
}

export interface Reservation {
  id: string;
  name: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  guests: number;
  tableNo?: string;
  notes?: string;
  status: "Booked" | "Seated" | "Cancelled" | "Completed";
}

export interface EventBooking {
  id: string;
  name: string;
  mobile: string;
  date: string;
  time: string;
  eventName: string;
  notes?: string;
  payable: number;
  advance: number;
  payMode: "Cash" | "Online" | "Credit";
  status: "Booked" | "Completed" | "Cancelled";
}

const KEYS = {
  products: "cafe.products",
  customers: "cafe.customers",
  orders: "cafe.orders",
  reservations: "cafe.reservations",
  events: "cafe.events",
  staff: "cafe.staff",
  categories: "cafe.categories",
  tableStatus: "cafe.tableStatus",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

import { supabase } from "@/integrations/supabase/client";

function writeCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// Signature of our last cloud write per key, used to ignore self-echoes from realtime.
const lastWriteSig: Record<string, string> = {};

export function useLocal<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const load = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          setState(read(key, initial));
          setHydrated(true);
          return;
        }

        const { data, error } = await supabase
          .from("app_kv")
          .select("value")
          .eq("key", key)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;

        if (data && data.value !== null && data.value !== undefined) {
          const cloudVal = data.value as T;
          setState(cloudVal);
          writeCache(key, cloudVal);
        } else {
          // Cloud empty — migrate localStorage (or default) to cloud once.
          const localVal = read(key, initial);
          lastWriteSig[key] = JSON.stringify(localVal);
          await supabase.from("app_kv").upsert({
            key,
            value: localVal as any,
            updated_at: new Date().toISOString(),
            updated_by: sess.session.user.id,
          });
          setState(localVal);
          writeCache(key, localVal);
        }
        setHydrated(true);

        channel = supabase
          .channel(`app_kv:${key}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "app_kv", filter: `key=eq.${key}` },
            (payload) => {
              const next = (payload.new as any)?.value;
              if (next === undefined) return;
              const sig = JSON.stringify(next);
              if (lastWriteSig[key] === sig) return;
              setState(next as T);
              writeCache(key, next as T);
            }
          )
          .subscribe();
      } catch (e) {
        console.error(`[useLocal:${key}]`, e);
        setState(read(key, initial));
        setHydrated(true);
      }
    };

    load();

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        if (channel) { supabase.removeChannel(channel); channel = null; }
        setHydrated(false);
        load();
      }
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setState(read(key, initial));
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (v: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        writeCache(key, next);
        (async () => {
          try {
            const { data: sess } = await supabase.auth.getSession();
            if (!sess.session) return;
            lastWriteSig[key] = JSON.stringify(next);
            const { error } = await supabase.from("app_kv").upsert({
              key,
              value: next as any,
              updated_at: new Date().toISOString(),
              updated_by: sess.session.user.id,
            });
            if (error) throw error;
          } catch (e: any) {
            console.error(`[useLocal:${key}] save failed`, e);
            const { toast } = await import("sonner");
            toast.error(`Couldn't save: ${e?.message ?? "network error"}`);
          }
        })();
        return next;
      });
    },
    [key]
  );

  return [state, update, hydrated] as const;
}

export const useProducts = () =>
  useLocal<Product[]>(KEYS.products, [
    { id: "p1", name: "Cappuccino", category: "Coffee", price: 120, discount: 0, stock: 50, modifiers: ["Less Sugar", "Extra Sugar", "Soy Milk"] },
    { id: "p2", name: "Cheese Burger", category: "Burger", price: 150, discount: 10, stock: 30, modifiers: ["Extra Cheese", "No Onion", "Spicy"] },
    { id: "p3", name: "Cold Coffee", category: "Cold Drinks", price: 140, discount: 0, stock: 40, modifiers: ["Less Ice", "Extra Ice"] },
    { id: "p4", name: "French Fries", category: "Snacks", price: 90, discount: 0, stock: 60, modifiers: ["Salted", "Peri-Peri", "Cheesy"] },
    { id: "p5", name: "Combo Meal", category: "Combo", price: 99, discount: 0, stock: 20 },
  ]);

export const useCustomers = () =>
  useLocal<Customer[]>(KEYS.customers, [
    { id: "c1", name: "Walk-in", mobile: "", visits: 0, totalSpend: 0, notes: "" },
  ]);

export const useOrders = () => useLocal<Order[]>(KEYS.orders, []);
export const useReservations = () => useLocal<Reservation[]>(KEYS.reservations, []);
export const useEvents = () => useLocal<EventBooking[]>(KEYS.events, []);
export const useStaff = () => useLocal<Staff[]>(KEYS.staff, []);
export const useCategories = () =>
  useLocal<string[]>(KEYS.categories, ["Coffee", "Burger", "Cold Drinks", "Snacks", "Combo", "Other"]);

const defaultTableStatuses = (): Record<string, TableStatus> =>
  TABLE_NUMBERS.reduce((acc, t) => ({ ...acc, [t]: "Available" }), {} as Record<string, TableStatus>);
export const useTableStatuses = () =>
  useLocal<Record<string, TableStatus>>(KEYS.tableStatus, defaultTableStatuses());

export const uid = () => Math.random().toString(36).slice(2, 10);

export const nextOrderId = (orders: Order[]) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = orders.filter((o) => o.id.startsWith(`ORD-${today}`)).length + 1;
  return `ORD-${today}-${String(count).padStart(3, "0")}`;
};

export const priceAfter = (p: Product) =>
  Math.round(p.price * (1 - (p.discount || 0) / 100));

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
