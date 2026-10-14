"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Gift, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PUB_EYEBROW_CLASS, PUB_PILL_BUTTON_CLASS } from "@/components/public/public-ui";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import { FALLBACK_FOIL, readThemeColour } from "@/components/public/rewards/theme-colour";
import { scratchCanRetry, scratchErrorCopy, useScratchCard } from "@/components/public/rewards/use-diner-cards";
import {
  CARD_TERMS,
  EVERY_CARD_WINS,
  everyCardWins,
  type DinerReadyCardDto,
} from "@pos/shared/public-diner-cards";

// CB-7 S4 — the scratch sheet. The card is large and centred; the foil canvas sits OVER the prize area. The first
// touch (or "Tap to reveal") sends the scratch to the server; the outcome text comes ONLY from that answer — never
// from the cached wallet and never before the answer — and shows once the foil is half wiped or Tap was pressed.
// A failed request reveals nothing: the foil resets and "Try again" is offered.

interface FoilProps {
  hint: string;
  onFirstScratch: () => void;
  onEnough: () => void;
}

// The foil without a canvas: the reduced-motion cover, and the fallback when the canvas chunk cannot load (offline
// after the page loaded — without this the rejection would throw to the error page and stay cached until a reload).
// "Tap to reveal" still works over it.
function StaticFoil(_props: FoilProps) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-primary text-primary-foreground">
      <Sparkles className="h-12 w-12 text-primary-foreground/60" aria-hidden="true" />
    </div>
  );
}

const ScratchCanvas = dynamic(
  () => import("@/components/public/rewards/ScratchCanvas").catch(() => ({ default: StaticFoil })),
  { ssr: false },
);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SCRATCH_HINT = "Scratch here";
const CONFETTI_PARTICLES = 90;
const CONFETTI_SPREAD = 70;
const CONFETTI_ORIGIN_Y = 0.65;
// The confetti library's own palette, kept after the cafe colour so the burst still reads as a celebration.
const CONFETTI_DEFAULT_COLOURS = ["#26ccff", "#a25afd", "#ff5e7e", "#88ff5a", "#fcff42", "#ffa62d", "#ff36ff"];

interface ScratchBodyProps {
  card: DinerReadyCardDto;
  identity: string | null;
  onDone: () => void;
}

function ScratchBody({ card, identity, onDone }: ScratchBodyProps) {
  const scratch = useScratchCard(identity);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY) === true;
  const [enough, setEnough] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [foilKey, setFoilKey] = useState(0);

  // The ONLY source of outcome text: the scratch mutation's own server answer.
  const answered = scratch.data?.card;
  const outcome = answered && "outcome" in answered ? answered.outcome : null;
  const shown = outcome !== null && (enough || tapped || reduced) ? outcome : null;
  const failed = scratch.isError || (answered !== undefined && outcome === null);
  const errorCopy = scratchErrorCopy(scratch.isError ? scratch.error : null);
  const canRetry = scratchCanRetry(scratch.isError ? scratch.error : null);
  const shownKind = shown?.kind ?? null;

  useEffect(() => {
    if (shownKind === null || shownKind === "none" || reduced) return;
    void import("canvas-confetti")
      .then((mod) => {
        // Our own instance, not the default export: the default one is hard-wired to a blob Worker, which the /m CSP
        // (no worker-src) blocks. The library appends its canvas and removes it when the burst ends.
        const fire = mod.create(undefined, { resize: true, useWorker: false, disableForReducedMotion: true });
        return fire({
          particleCount: CONFETTI_PARTICLES,
          spread: CONFETTI_SPREAD,
          origin: { y: CONFETTI_ORIGIN_Y },
          colors: [readThemeColour("--primary", FALLBACK_FOIL), ...CONFETTI_DEFAULT_COLOURS],
          disableForReducedMotion: true,
        });
      })
      .catch(() => undefined);
  }, [shownKind, reduced]);

  // A failed scratch shows nothing: drop the progress and put a fresh foil back.
  function resetFoil(): void {
    setEnough(false);
    setTapped(false);
    setFoilKey((k) => k + 1);
  }

  function start(viaTap: boolean): void {
    if (viaTap) setTapped(true);
    if (scratch.isPending || outcome !== null) return;
    scratch.mutate(card.id, { onError: resetFoil });
  }

  const foilProps: FoilProps = { hint: SCRATCH_HINT, onFirstScratch: () => start(false), onEnough: () => setEnough(true) };
  const kinds = card.pool.map((choice) => choice.kind);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-pub-display text-xl">Scratch your card</SheetTitle>
        <SheetDescription>
          {card.title ? `${card.title} · ` : ""}
          {deadlineLine("scratch", card.scratchBy, Date.now())}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 py-4">
        <div className="relative mx-auto aspect-square w-full max-w-72 overflow-hidden rounded-2xl bg-muted">
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            {shown ? (
              <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
                <p className="break-words font-pub-display text-3xl font-semibold leading-tight">{shown.label}</p>
                {shown.condition !== null && <p className="mt-2 text-sm text-muted-foreground">{shown.condition}</p>}
              </div>
            ) : (
              <Gift className="h-14 w-14 text-muted-foreground/40" aria-hidden="true" />
            )}
          </div>
          {!shown &&
            (reduced ? (
              <StaticFoil {...foilProps} />
            ) : (
              <ScratchCanvas key={foilKey} {...foilProps} />
            ))}
        </div>

        {/* Filled at reveal only, so a screen reader hears the result once and never a half-state. */}
        <p aria-live="polite" role="status" className="sr-only">
          {shown ? `Your card: ${shown.label}` : ""}
        </p>

        {scratch.isPending && <p className="text-center text-sm text-muted-foreground">Opening your card...</p>}

        {failed && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl bg-muted p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="flex-1">{errorCopy}</p>
          </div>
        )}

        <Button
          type="button"
          className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
          disabled={scratch.isPending || shown !== null || (scratch.isError && !canRetry)}
          onClick={() => start(true)}
        >
          Tap to reveal
        </Button>

        {failed && canRetry && (
          <Button
            type="button"
            variant="outline"
            className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
            onClick={() => start(true)}
          >
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        )}

        {shown && (
          <Button
            type="button"
            variant="outline"
            className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
            onClick={onDone}
          >
            Done
          </Button>
        )}

        <div className="space-y-2">
          <p className={PUB_EYEBROW_CLASS}>Chances in this card</p>
          <ul className="space-y-1 text-sm">
            {card.pool.map((choice, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{choice.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{choice.chance}%</span>
              </li>
            ))}
          </ul>
          {everyCardWins(kinds) && <p className="text-sm font-medium">{EVERY_CARD_WINS}</p>}
          <p className="text-xs text-muted-foreground">{CARD_TERMS}</p>
        </div>
      </div>
    </>
  );
}

interface PublicScratchSheetProps {
  card: DinerReadyCardDto | null;
  open: boolean;
  identity: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PublicScratchSheet({ card, open, identity, onOpenChange }: PublicScratchSheetProps) {
  return (
    <Sheet open={open && card !== null} onOpenChange={onOpenChange}>
      {/* [&>button] = the primitive's own close X (the only direct-child button): a 44 px target. */}
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-xl [&>button]:right-1.5 [&>button]:top-1.5 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
      >
        {card && <ScratchBody key={card.id} card={card} identity={identity} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}
