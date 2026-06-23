import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CAFE_UTC_OFFSET_MINUTES } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Escape user input before interpolating it into a RegExp (search-by-name/mobile).
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  return `${hour > 12 ? hour - 12 : hour}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

// "5m ago" / "2h ago" / "3d ago" relative-time label for recent activity feeds.
export function timeAgo(date: string | Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function generateOrderId(sequence: number): string {
  const date = cafeDateString().replace(/-/g, "");
  return `ORD-${date}-${String(sequence).padStart(3, "0")}`;
}

const CAFE_OFFSET_MS = CAFE_UTC_OFFSET_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The cafe-local (IST) calendar date of an instant, as "YYYY-MM-DD".
// Independent of the server timezone (works on a UTC host).
export function cafeDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + CAFE_OFFSET_MS).toISOString().slice(0, 10);
}

// Start/end UTC instants of the cafe-local (IST) day containing `date`.
// Used for createdAt range queries so "today" matches the cafe's business day.
export function dayRange(date: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(date.getTime() + CAFE_OFFSET_MS);
  const cafeMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const start = new Date(cafeMidnightUtc - CAFE_OFFSET_MS);
  const end = new Date(cafeMidnightUtc - CAFE_OFFSET_MS + ONE_DAY_MS - 1);
  return { start, end };
}

// Per-day cache key for the dashboard order summary, keyed by the cafe-local
// date (shared by the summary endpoint and order writes that invalidate it).
export function orderSummaryCacheKey(date: Date = new Date()): string {
  return `order-summary-${cafeDateString(date)}`;
}

// Cafe-local (IST) hour-of-day (0-23) of an instant. Used to bucket today's
// sales into hourly slots for the dashboard peak-hours chart, independent of
// the server timezone (works on a UTC host, same as cafeDateString/dayRange).
export function cafeHourOf(date: Date = new Date()): number {
  return new Date(date.getTime() + CAFE_OFFSET_MS).getUTCHours();
}
