import type { DashboardChannel } from "@/types/dashboard";
import type { ReservationStatus, SettlementPayMode, TableStatus } from "@/lib/constants";

export type StatusKind = "ok" | "warn" | "bad" | "info" | "bill" | "reserved" | "neutral";

export type StatusClasses = { dot: string; ink: string; tint: string; border: string; pill: string };

export const STATUS_CLASSES: Record<StatusKind, StatusClasses> = {
  ok: { dot: "bg-status-ok", ink: "text-status-ok-ink", tint: "bg-status-ok-tint", border: "border-transparent", pill: "bg-status-ok-tint text-status-ok-ink" },
  warn: { dot: "bg-status-warn", ink: "text-status-warn-ink", tint: "bg-status-warn-tint", border: "border-transparent", pill: "bg-status-warn-tint text-status-warn-ink" },
  bad: { dot: "bg-status-bad", ink: "text-status-bad-ink", tint: "bg-status-bad-tint", border: "border-transparent", pill: "bg-status-bad-tint text-status-bad-ink" },
  info: { dot: "bg-status-info", ink: "text-status-info-ink", tint: "bg-status-info-tint", border: "border-status-info-border", pill: "bg-status-info-tint text-status-info-ink" },
  bill: { dot: "bg-status-bill", ink: "text-status-bill-ink", tint: "bg-status-bill-tint", border: "border-status-bill-border", pill: "bg-status-bill-tint text-status-bill-ink" },
  reserved: { dot: "bg-status-reserved", ink: "text-status-reserved-ink", tint: "bg-status-reserved-tint", border: "border-status-reserved-border", pill: "bg-status-reserved-tint text-status-reserved-ink" },
  neutral: { dot: "bg-subtle-foreground", ink: "text-muted-foreground", tint: "bg-muted", border: "border-transparent", pill: "bg-muted text-muted-foreground" },
};

/** The owner's HTML note box tones (POS values 11.1: the payment sheet's due and method notes; design 6.8): a tint on its
 *  own 1px rule — warn for something to check, bad for a refusal, neutral on --surface-2. The box itself (radius 10,
 *  padding 14, 13.5px, line-height 1.5, --text-2) is the component's (components/pos/WriteNotice.tsx). */
export type NoteTone = "warn" | "bad" | "neutral";

export const NOTE_TONE_CLASSES: Record<NoteTone, string> = {
  warn: "border-status-warn bg-status-warn-tint",
  bad: "border-status-bad bg-status-bad-tint",
  neutral: "border-border bg-surface-2",
};

export const PAYMENT_KIND: Record<SettlementPayMode, StatusKind> = {
  Online: "info",
  Cash: "ok",
  Split: "reserved",
  Due: "bill",
  Credit: "warn",
};

// The dashboard's recent orders: an open tab ("Open") is warn among the HTML's pill colours (U0 match Task 8).
export const PAY_PILL_KIND: Record<SettlementPayMode | "Unpaid", StatusKind> = { ...PAYMENT_KIND, Unpaid: "warn" };

// Keyed by the dashboard's channel keys (foldChannels rows carry `key`).
export const CHANNEL_KIND: Record<DashboardChannel, StatusKind> = {
  "dine-in": "info",
  takeaway: "warn",
  qr: "reserved",
  counter: "ok",
};

export const TABLE_KIND: Record<TableStatus, StatusKind> = { Available: "ok", Occupied: "info", Reserved: "reserved" };

export const RESERVATION_KIND: Record<ReservationStatus, StatusKind> = {
  Booked: "info",
  Seated: "ok",
  Completed: "neutral",
  Cancelled: "bad",
};
