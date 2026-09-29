import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarClock, CircleCheck, CircleSlash, HandCoins, Hourglass } from "lucide-react";
import { inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import type { DashboardLive } from "@/types/dashboard";

// "Needs attention" — what someone should act on RIGHT NOW, whatever period
// the numbers below show. Only non-zero items appear, most urgent first; the
// row keeps one fixed height (it scrolls sideways on a phone rather than
// wrapping), so a count appearing or clearing never pushes the page.

interface Chip {
  key: string;
  icon: LucideIcon;
  text: string;
  href: string;
  title?: string;
}

function chipsOf(live: DashboardLive): Chip[] {
  const chips: Chip[] = [];
  if (live.pendingRequests > 0) {
    chips.push({ key: "requests", icon: BellRing, text: `${plural(live.pendingRequests, "QR order")} waiting`, href: "/requests" });
  }
  if (live.openTabs.count > 0) {
    chips.push({
      key: "tabs",
      icon: Hourglass,
      text: `${plural(live.openTabs.count, "open tab")} · ${inr(live.openTabs.value)}`,
      href: "/orders?payment=Unpaid&status=Pending",
    });
  }
  if (live.bookingsToday > 0) {
    chips.push({ key: "bookings", icon: CalendarClock, text: `${plural(live.bookingsToday, "booking")} today`, href: "/reservations" });
  }
  if (live.unavailable.count > 0) {
    const more = live.unavailable.count - live.unavailable.names.length;
    chips.push({
      key: "unavailable",
      icon: CircleSlash,
      text: `${plural(live.unavailable.count, "item")} unavailable`,
      href: "/products",
      title: `${live.unavailable.names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    });
  }
  if (live.dues.total > 0) {
    chips.push({
      key: "dues",
      icon: HandCoins,
      text: `${inr(live.dues.total)} due from ${plural(live.dues.customers, "customer")}`,
      href: "/customers",
    });
  }
  return chips;
}

const CHIP_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-rule bg-brand-paper px-3 text-[13px] text-brand-ink transition-colors hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export function AttentionStrip({ live, loading, isError }: { live?: DashboardLive; loading: boolean; isError: boolean }) {
  const chips = live ? chipsOf(live) : [];
  return (
    <section
      aria-label="Needs attention"
      className="flex min-h-12 items-center gap-3 rounded-xl border border-brand-rule bg-brand-slip px-3 py-2 sm:px-4"
    >
      <h2 className="hidden shrink-0 text-[13px] font-semibold text-brand-ink sm:block">Needs attention</h2>
      {/* w-0 + flex-1: the chips' combined width must never become the page's minimum width (measured: it widened the whole screen at 1024 px and on phones). */}
      <div className="flex w-0 min-w-0 flex-1 items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
        {loading && !live ? (
          <>
            <BrandSkeleton className="h-8 w-36 shrink-0 rounded-full" />
            <BrandSkeleton className="h-8 w-40 shrink-0 rounded-full" />
            <BrandSkeleton className="h-8 w-32 shrink-0 rounded-full" />
          </>
        ) : isError && !live ? (
          <p className="text-[13px] text-brand-muted">Couldn&apos;t load the live counts. Trying again…</p>
        ) : chips.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[13px] text-brand-muted">
            <CircleCheck className="h-4 w-4 text-brand-up" aria-hidden />
            All clear — nothing needs attention right now.
          </p>
        ) : (
          chips.map((c) => (
            <Link key={c.key} href={c.href} title={c.title} className={CHIP_CLASS}>
              <c.icon className="h-3.5 w-3.5 text-brand-muted" aria-hidden />
              {c.text}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
