"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PUB_EYEBROW_CLASS } from "@/components/public/public-ui";
import { cardDetailView } from "@/components/public/rewards/card-detail-view";
import { EVERY_CARD_WINS, type DinerRevealedCardDto } from "@pos/shared/public-diner-cards";

// CB-7 S6 — a revealed card's detail sheet: what it gives, any condition, when to use it by, the chances it was drawn
// from and the plain terms. Everything comes from the wallet's own card, so it opens instantly and never fetches.
const DETAIL_FALLBACK = "Here is what this card gives you.";

interface PublicCardDetailSheetProps {
  card: DinerRevealedCardDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublicCardDetailSheet({ card, open, onOpenChange }: PublicCardDetailSheetProps) {
  const view = card ? cardDetailView(card, Date.now()) : null;
  return (
    <Sheet open={open && view !== null} onOpenChange={onOpenChange}>
      {/* [&>button] = the primitive's own close X (the only direct-child button): a 44 px target. */}
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-xl [&>button]:right-1.5 [&>button]:top-1.5 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
      >
        {view && (
          <>
            <SheetHeader>
              <SheetTitle className="break-words font-pub-display text-xl">{view.title}</SheetTitle>
              <SheetDescription>{view.useBy ?? DETAIL_FALLBACK}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 py-4">
              {view.condition !== null && <p className="text-sm">{view.condition}</p>}
              {view.pointsLeft !== null && <p className="text-sm font-medium">{view.pointsLeft}</p>}
              <div className="space-y-2">
                <p className={PUB_EYEBROW_CLASS}>Chances in this card</p>
                <ul className="space-y-1 text-sm">
                  {view.chances.map((choice, index) => (
                    <li key={index} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{choice.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{choice.chance}%</span>
                    </li>
                  ))}
                </ul>
                {view.everyCardWins && <p className="text-sm font-medium">{EVERY_CARD_WINS}</p>}
              </div>
              <div className="space-y-1">
                {view.terms.map((term) => (
                  <p key={term} className="text-xs text-muted-foreground">
                    {term}
                  </p>
                ))}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
