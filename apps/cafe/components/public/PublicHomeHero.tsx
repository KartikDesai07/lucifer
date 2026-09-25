"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { brandingUrl, productImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { PUB_DISPLAY_TITLE_CLASS, PUB_TINT_CLASS } from "@/components/public/public-ui";
import { greetingFor } from "@/components/public/public-home-data";
import type { LogoPlacement } from "@pos/shared/appearance";

// CB-6D-A — Home's header, rewritten calm and premium: no full-bleed brand
// block, no CTA button (the tab bar and the "See menu" links on each row own
// that path now). Left: a time-of-day greeting over the diner's name (signed
// in) or the cafe name. Right: a 44px round monogram — the cafe's logo, or
// the cafe name's first CODE POINT on a brand tint when there is no logo, it
// is hidden, or it fails to load. An optional photo band underneath, only
// when the owner has set one — a bare cafe stays whitespace, not a gap.
//
// The hour is read once on mount (never during SSR, so a server-rendered
// "Welcome" never mismatches a client-rendered greeting) and held in state —
// the initial paint always reads "Welcome".

const HERO_SIZES = "(max-width: 512px) 100vw, 512px";

interface PublicHomeHeroProps {
  cafeName: string;
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
  signedIn: boolean;
  dinerName: string;
}

// First CODE POINT of the cafe name, never the first UTF-16 code unit — a
// name starting with an emoji or a Devanagari letter would otherwise render a
// broken half-character (memory: code-unit cuts break emoji/Devanagari).
function firstCodePoint(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "•";
  return [...trimmed][0] ?? "•";
}

export function PublicHomeHero({ cafeName, chrome, signedIn, dinerName }: PublicHomeHeroProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [greeting, setGreeting] = useState("Welcome");

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const heading = signedIn && dinerName.length > 0 ? dinerName : cafeName;
  const showLogo = chrome.logoPlacement !== "hidden";
  const heroUrl = chrome.heroImage !== "" ? productImageUrl(chrome.heroImage) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{greeting}</p>
          {heading !== "" && <p className={cn(PUB_DISPLAY_TITLE_CLASS, "truncate")}>{heading}</p>}
        </div>
        {showLogo && <PublicHomeHeroMonogram cafeName={cafeName} failed={logoFailed} onFail={() => setLogoFailed(true)} />}
      </div>

      {heroUrl && (
        <div className="relative h-40 overflow-hidden rounded-3xl">
          <Image
            src={heroUrl}
            alt=""
            fill
            sizes={HERO_SIZES}
            className="object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-primary/70 to-transparent" />
          {cafeName !== "" && (
            <p className="absolute bottom-3 left-4 font-pub-display text-lg font-semibold text-primary-foreground">
              {cafeName}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PublicHomeHeroMonogram({
  cafeName,
  failed,
  onFail,
}: {
  cafeName: string;
  failed: boolean;
  onFail: () => void;
}) {
  if (failed) {
    return (
      <span className={cn(PUB_TINT_CLASS, "grid h-11 w-11 shrink-0 place-items-center rounded-full font-pub-display font-semibold")} aria-hidden="true">
        {firstCodePoint(cafeName)}
      </span>
    );
  }
  return (
    <Image
      src={brandingUrl("logo")}
      alt=""
      width={44}
      height={44}
      className="h-11 w-11 shrink-0 rounded-full bg-muted object-contain"
      onError={onFail}
    />
  );
}
