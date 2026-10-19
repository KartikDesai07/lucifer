import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// The one widget shell on the Dashboard (Paper & Ink): a title, the period it
// covers, an optional link, and exactly one of four bodies — a skeleton the
// SAME height as the content (no jump when data lands), a guided empty state,
// an error with a retry, or the content. `updating` dims the content while a
// newly chosen range loads (the old numbers stay put instead of flashing out).
// U0 match Task 5: `variant="dashboard"` is the owner's HTML generic card (values 3.0: surface, a 1px border, radius
// 14, padding 18px 20px; title 15/600, subtitle 12.5 text-3 3px under it, header link 13/500 in the link colour with
// " →"), its four bodies in the same language. The default keeps the reports pages' look until their own session.

export type DashCardStatus = "loading" | "error" | "empty" | "ready";

export interface DashCardEmpty {
  title: string;
  description: string;
}

export type DashCardVariant = "report" | "dashboard";

interface DashCardProps {
  title: string;
  period?: string;
  link?: { href: string; label: string };
  status: DashCardStatus;
  empty?: DashCardEmpty;
  onRetry?: () => void;
  updating?: boolean;
  /** Height the skeleton / empty / error bodies hold, so every state is the same size. */
  bodyMinHeight: number;
  /** Responsive min-height classes instead (e.g. a phone layout that is taller). */
  bodyClassName?: string;
  className?: string;
  /** "report" (default): the reports pages' look. "dashboard": the HTML's generic card. */
  variant?: DashCardVariant;
  /** The dashboard card's space between its head and its body, in px (values 3.5–3.14; default 14). */
  bodyGap?: DashCardBodyGap;
  /** Dashboard cards: what sits at the head's right instead of a link (Sales by hour's legend, values 3.5). */
  aside?: ReactNode;
  /** Dashboard cards: a mark 8px after the title's words (Live tables' pulsing dot, values 3.6). */
  titleAdornment?: ReactNode;
  /** Dashboard cards: the head wraps (values 3.5's `flex-wrap`). */
  headWrap?: boolean;
  /** Dashboard cards: the section's probe hook (data-ui), "dash-card" unless the card names itself. */
  ui?: string;
  children?: ReactNode;
}

/** The HTML cards' own space under the head: 8 (Top items), 10 (Recent orders, Today's reservations), 14 (most:
 *  status bars, totals, lists, the category bar, the busy-hours grid), 18 (the hour chart's plot). */
export type DashCardBodyGap = 8 | 10 | 14 | 18;
const BODY_GAP_CLASS: Record<DashCardBodyGap, string> = { 8: "mt-2", 10: "mt-2.5", 14: "mt-3.5", 18: "mt-[18px]" };

export const DASH_CARD_CLASS = "min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5";

export function BrandSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-brand-wash motion-safe:animate-pulse", className)} />;
}

/** A dashboard card's skeleton: the HTML's surface-3 grey. */
export function DashSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-surface-3 motion-safe:animate-pulse", className)} />;
}

interface Look {
  section: string;
  head: string;
  title: string;
  sub: string;
  link: string;
  errorText: string;
  retry: string;
  emptyTitle: string;
  emptyText: string;
  Skeleton: (p: { className?: string }) => ReactNode;
}

const LOOKS: Record<DashCardVariant, Look> = {
  report: {
    section: DASH_CARD_CLASS,
    head: "mb-3 flex items-start justify-between gap-3",
    title: "text-[15px] font-semibold leading-tight text-brand-ink",
    sub: "mt-1 text-[12.5px] leading-tight text-brand-muted",
    link: "-mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
    errorText: "text-sm text-brand-muted",
    retry:
      "inline-flex items-center gap-1.5 rounded-md border border-brand-rule px-3 py-1.5 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
    emptyTitle: "text-sm font-medium text-brand-ink",
    emptyText: "max-w-xs text-[13px] text-brand-muted",
    Skeleton: BrandSkeleton,
  },
  dashboard: {
    section: "min-w-0 rounded-[14px] border border-border bg-card px-5 py-[18px] leading-[normal] text-foreground",
    head: "flex items-start justify-between gap-3",
    title: "text-[15px] font-semibold",
    sub: "mt-[3px] text-[12.5px] text-subtle-foreground",
    // The HTML's header link buttons ("Floor →", "All orders →"): no box, 13/500 in the link colour.
    link: "shrink-0 whitespace-nowrap text-[13px] font-medium text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    errorText: "text-[13px] text-muted-foreground",
    // The HTML's small outline button (the reservations' "Seat"): 30px, radius 8, 12.5/500.
    retry:
      "inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-border bg-card px-[11px] text-[12.5px] font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    emptyTitle: "text-[13.5px] font-medium",
    emptyText: "max-w-xs text-[12.5px] text-subtle-foreground",
    Skeleton: DashSkeleton,
  },
};

export function DashCardHeader({
  title,
  period,
  link,
  id,
  variant = "report",
  aside,
  titleAdornment,
  headWrap,
}: {
  title: string;
  period?: string;
  link?: { href: string; label: string };
  id: string;
  variant?: DashCardVariant;
  aside?: ReactNode;
  titleAdornment?: ReactNode;
  headWrap?: boolean;
}) {
  const look = LOOKS[variant];
  // Probe hooks (data-ui) on the dashboard's card only; the reports' markup stays as it was.
  const ui = (name: string) => (variant === "dashboard" ? name : undefined);
  return (
    <header data-ui={ui("dash-card-head")} className={headWrap ? cn(look.head, "flex-wrap") : look.head}>
      <div className="min-w-0">
        <h2 id={id} data-ui={ui("dash-card-title")} className={titleAdornment ? cn(look.title, "flex items-center gap-2") : look.title}>
          {title}
          {titleAdornment}
        </h2>
        {period && (
          <p data-ui={ui("dash-card-sub")} className={look.sub}>
            {period}
          </p>
        )}
      </div>
      {link && (
        <Link href={link.href} data-ui={ui("dash-card-link")} className={look.link}>
          {variant === "dashboard" ? (
            `${link.label} →`
          ) : (
            <>
              {link.label}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </>
          )}
        </Link>
      )}
      {aside}
    </header>
  );
}

const slug = (title: string) => `dash-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function DashCard({
  title,
  period,
  link,
  status,
  empty,
  onRetry,
  updating,
  bodyMinHeight,
  bodyClassName,
  className,
  variant = "report",
  bodyGap = 14,
  aside,
  titleAdornment,
  headWrap,
  ui = "dash-card",
  children,
}: DashCardProps) {
  const id = slug(title);
  const look = LOOKS[variant];
  const dashboard = variant === "dashboard";
  // The reports' head carries its own 12px margin instead.
  const gap = dashboard ? BODY_GAP_CLASS[bodyGap] : undefined;
  const minStyle = bodyClassName ? undefined : { minHeight: bodyMinHeight };
  const Skeleton = look.Skeleton;
  return (
    <section
      aria-labelledby={id}
      aria-busy={status === "loading" || updating}
      data-ui={dashboard ? ui : undefined}
      className={cn(look.section, className)}
    >
      <DashCardHeader
        id={id}
        title={title}
        period={period}
        link={link}
        variant={variant}
        aside={aside}
        titleAdornment={titleAdornment}
        headWrap={headWrap}
      />
      {status === "loading" ? (
        <div style={bodyClassName ? undefined : { height: bodyMinHeight }} className={cn("flex", gap, bodyClassName)}>
          <Skeleton className="w-full" />
        </div>
      ) : status === "error" ? (
        <div style={minStyle} className={cn("flex flex-col items-center justify-center gap-3 text-center", gap, bodyClassName)}>
          <p className={look.errorText}>Couldn&apos;t load this. It will try again on its own.</p>
          {onRetry && (
            <button type="button" onClick={onRetry} data-ui={dashboard ? "dash-card-retry" : undefined} className={look.retry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          )}
        </div>
      ) : status === "empty" && empty ? (
        <div style={minStyle} className={cn("flex flex-col items-center justify-center gap-1 px-4 text-center", gap, bodyClassName)}>
          <p className={look.emptyTitle}>{empty.title}</p>
          <p className={look.emptyText}>{empty.description}</p>
        </div>
      ) : (
        <div style={minStyle} className={cn("transition-opacity duration-200", gap, updating && "opacity-55", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
