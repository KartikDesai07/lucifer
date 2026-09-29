import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// The one widget shell on the Dashboard (Paper & Ink): a title, the period it
// covers, an optional link, and exactly one of four bodies — a skeleton the
// SAME height as the content (no jump when data lands), a guided empty state,
// an error with a retry, or the content. `updating` dims the content while a
// newly chosen range loads (the old numbers stay put instead of flashing out).

export type DashCardStatus = "loading" | "error" | "empty" | "ready";

export interface DashCardEmpty {
  title: string;
  description: string;
}

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
  children?: ReactNode;
}

export const DASH_CARD_CLASS = "min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5";

export function BrandSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-brand-wash motion-safe:animate-pulse", className)} />;
}

export function DashCardHeader({
  title,
  period,
  link,
  id,
}: {
  title: string;
  period?: string;
  link?: { href: string; label: string };
  id: string;
}) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold leading-tight text-brand-ink">
          {title}
        </h2>
        {period && <p className="mt-1 text-[12.5px] leading-tight text-brand-muted">{period}</p>}
      </div>
      {link && (
        <Link
          href={link.href}
          className="-mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          {link.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
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
  children,
}: DashCardProps) {
  const id = slug(title);
  const minStyle = bodyClassName ? undefined : { minHeight: bodyMinHeight };
  return (
    <section aria-labelledby={id} aria-busy={status === "loading" || updating} className={cn(DASH_CARD_CLASS, className)}>
      <DashCardHeader id={id} title={title} period={period} link={link} />
      {status === "loading" ? (
        <div style={bodyClassName ? undefined : { height: bodyMinHeight }} className={cn("flex", bodyClassName)}>
          <BrandSkeleton className="w-full" />
        </div>
      ) : status === "error" ? (
        <div style={minStyle} className={cn("flex flex-col items-center justify-center gap-3 text-center", bodyClassName)}>
          <p className="text-sm text-brand-muted">Couldn&apos;t load this. It will try again on its own.</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-rule px-3 py-1.5 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          )}
        </div>
      ) : status === "empty" && empty ? (
        <div style={minStyle} className={cn("flex flex-col items-center justify-center gap-1 px-4 text-center", bodyClassName)}>
          <p className="text-sm font-medium text-brand-ink">{empty.title}</p>
          <p className="max-w-xs text-[13px] text-brand-muted">{empty.description}</p>
        </div>
      ) : (
        <div style={minStyle} className={cn("transition-opacity duration-200", updating && "opacity-55", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
