"use client";

import { Button } from "@/components/ui/button";

// Segment error boundary for the ENTIRE public diner surface (/m, /m/<token>,
// /m/o/<code>). Without this, any client-side exception on a diner's phone
// renders a blank white page — the exact failure mode reported from the field
// on 2026-08-20. A diner can never be shown a blank screen: they get a plain
// retry affordance instead. Copy is generic product copy — never a cafe name.
export default function PublicMenuError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-base font-medium">Something went wrong.</p>
      <p className="text-sm text-muted-foreground">
        Your cart is saved on this phone — nothing is lost.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
