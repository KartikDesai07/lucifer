// Why a new file: one panel for every write outcome shown inside a popup (the
// settle here; Send to Kitchen and Pay Now reuse it) — the WriteNotice data
// and its wording live in lib/pending-writes.ts.
//
// U1 Task 5 (design 6.8; ruling P1): the owner's HTML note box (radius 10, padding 14, 13.5px, line-height 1.5, the
// text in --text-2, the title in --text 600), in the box's tones (lib/ui NOTE_TONE_CLASSES): a refusal or a gone tab
// in bad, anything to check in warn, an open notice in neutral. The words are unchanged.

import type { WriteNotice, WriteNoticeKind } from "@/lib/pending-writes";
import { NOTE_TONE_CLASSES, type NoteTone } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** Each write outcome's note-box tone. */
export const WRITE_NOTICE_TONE: Readonly<Record<WriteNoticeKind, NoteTone>> = {
  refused: "bad",
  gone: "bad",
  uncertain: "warn",
  changed: "warn",
  elsewhere: "warn",
  open: "neutral",
};

/** The HTML's note box in a tone (also the cart's menu notice, CartUnavailableNotice). */
export function noticeBoxClass(tone: NoteTone): string {
  return cn("rounded-[10px] border p-3.5 text-[13.5px] leading-[1.5] text-muted-foreground", NOTE_TONE_CLASSES[tone]);
}

export function WriteNoticePanel({ notice }: { notice: WriteNotice | null | undefined }) {
  if (!notice) return null;
  return (
    <div role="alert" data-ui="pos-write-notice" className={noticeBoxClass(WRITE_NOTICE_TONE[notice.kind])}>
      <p className="font-semibold text-foreground">{notice.title}</p>
      <p>{notice.message}</p>
    </div>
  );
}
