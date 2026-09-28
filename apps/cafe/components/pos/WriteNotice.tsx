// Why a new file: one panel for every write outcome shown inside a popup (the
// settle here; Send to Kitchen and Pay Now reuse it) — the WriteNotice data
// and its wording live in lib/pending-writes.ts. Colours reuse existing pairs:
// the destructive panel of OrderDetailSheet's cancelled block and the amber
// warning of PaymentModal's partial-payment line.

import type { WriteNotice, WriteNoticeKind } from "@/lib/pending-writes";
import { cn } from "@/lib/utils";

const TONE: Readonly<Record<WriteNoticeKind, string>> = {
  refused: "bg-destructive/10 text-destructive",
  gone: "bg-destructive/10 text-destructive",
  uncertain: "bg-amber-100 text-amber-800",
  changed: "bg-amber-100 text-amber-800",
  elsewhere: "bg-amber-100 text-amber-800",
  open: "bg-muted text-muted-foreground",
};

export function WriteNoticePanel({ notice }: { notice: WriteNotice | null | undefined }) {
  if (!notice) return null;
  return (
    <div role="alert" className={cn("space-y-0.5 rounded-md p-3 text-sm", TONE[notice.kind])}>
      <p className="font-semibold">{notice.title}</p>
      <p>{notice.message}</p>
    </div>
  );
}
