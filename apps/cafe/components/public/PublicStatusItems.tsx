"use client";

import { useEffect, useRef, useState } from "react";

import {
  PUBLIC_NOTE_MAX_LEN,
  PUBLIC_ORDER_MAX_QTY,
  type PublicOrderRequestStatusData,
  type PublicOrderRequestUpdatedData,
  type PublicStatusItem,
} from "@pos/shared/public";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PublicPromoField } from "@/components/public/PublicPromoField";
import { StatusItemRow } from "@/components/public/PublicStatusItemRow";
import {
  ACCEPTED_EDIT_NOTICE,
  buildStatusPatchBody,
  classifySaveError,
  classifyStatusSaveFailure,
  draftsEqual,
  EMPTY_DRAFT_HINT,
  isPromoErrorMessage,
  SAVE_FAILED_MESSAGE,
  SAVE_TIMEOUT_MS,
  seedDraft,
  type DraftLine,
} from "@/components/public/public-status-edit";

// Item lines on the diner's status page (CR2.2b §17.B) — always renders
// data.items (name×qty, line total, variation/modifiers/instructions muted),
// and, ONLY while the request is still "pending", turns each line into a
// [− qty +] stepper editing a LOCAL DRAFT (never auto-saved — one explicit
// PATCH on "Save changes", §17.C). "accepting" (staff already opened the
// request) renders read-only like accepted/rejected: the server's own status
// gate 409s an edit landed after that point (route.ts editStatusGuard), so
// offering steppers here would just walk a diner into a doomed Save.
interface PublicStatusItemsProps {
  shortCode: string;
  items: PublicStatusItem[];
  // The stored kitchen note off the status GET — round-tripped on every save
  // (the PATCH treats an ABSENT note as "keep", so a client that never sent
  // it would strand the diner unable to clear their own note; sending the
  // draft — "" included — is what makes clear/replace reachable).
  note: string | undefined;
  // The promo the request currently carries (status GET) — seeds the field so
  // a diner can SEE and Remove a code applied in an earlier round.
  promoCode: string | undefined;
  quotedDiscount: number | undefined;
  status: PublicOrderRequestStatusData["status"];
  // Lets the total/charge summary card (owned by PublicOrderStatus, unchanged
  // per §17.B point 2) adopt the PATCH response's total immediately, instead
  // of waiting out the next poll tick.
  onAdopt: (total: number, itemCount: number) => void;
  // A 409 mid-save means the request just left "pending" — force the
  // parent's poll loop to re-fetch right away rather than on its own cadence.
  onForceRepoll: () => void;
}

export function PublicStatusItems({ shortCode, items, note, promoCode, quotedDiscount, status, onAdopt, onForceRepoll }: PublicStatusItemsProps) {
  const [draft, setDraft] = useState<DraftLine[]>(() => seedDraft(items));
  const [noteDraft, setNoteDraft] = useState<string>(note ?? "");
  // CR2.2c §17.E — PublicOrderRequestStatusData carries NO promoCode field
  // Seeded from the status GET's own `promoCode`, so a code applied in an
  // earlier round is visible and removable. Draft semantics mirror `note`:
  // equal to the seed = untouched (Save OMITS the key, so the server keeps
  // what it has); `""` = the diner removed it (Save sends ""); any other
  // string = a code the diner just applied (Save sends it).
  const [promoDraft, setPromoDraft] = useState<string | null>(promoCode ?? null);
  const [promoError, setPromoError] = useState<string | null>(null);
  // Explicit seed snapshots for Discard — never rely on a re-render to undo
  // (project lesson: optimistic-rollback-needs-explicit-restore).
  const seedRef = useRef<DraftLine[]>(draft);
  const noteSeedRef = useRef<string>(note ?? "");
  const promoSeedRef = useRef<string | null>(promoCode ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = status === "pending";
  const dirty =
    editable &&
    (!draftsEqual(draft, seedRef.current) || noteDraft !== noteSeedRef.current || promoDraft !== promoSeedRef.current);
  // null/"" both render as "nothing applied" — only a real typed code shows the field's applied row.
  const promoCodeDisplay = promoDraft ? promoDraft : null;

  // Reseeds from whatever the server just handed us — but ONLY while not
  // mid-edit. A poll landing while dirty must update STATUS elsewhere
  // (PublicOrderStatus's own `data`) without ever touching this draft (the
  // exact overwrite §17.C forbids); once the diner leaves "pending" the
  // draft is moot anyway, so this also quietly resets it for a later
  // re-entry to "pending" (a fresh edit round) to start clean.
  useEffect(() => {
    if (dirty) return;
    const seeded = seedDraft(items);
    setDraft(seeded);
    seedRef.current = seeded;
    setNoteDraft(note ?? "");
    noteSeedRef.current = note ?? "";
    setPromoDraft(promoCode ?? null);
    promoSeedRef.current = promoCode ?? null;
    // NOTE: the error is deliberately NOT cleared here. A failed Save forces
    // an immediate re-poll, whose response reseeds through this very effect —
    // clearing here wiped the diner's only explanation ~300ms after showing
    // it, leaving quantities that snapped back for no visible reason (review
    // 2026-08-20). The error is cleared where it is actually stale: the next
    // edit the diner makes, or a save that succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dirty`/`editable` are read fresh from THIS render's closure on purpose: listing them would refire this effect on every local stepper tap instead of only when the SERVER hands new items.
  }, [items, note, promoCode]);

  function updateQty(lineId: string, qty: number) {
    setError(null); // a fresh edit makes any previous save error stale
    setDraft((prev) =>
      qty <= 0
        ? prev.filter((l) => l.lineId !== lineId)
        : prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.min(PUBLIC_ORDER_MAX_QTY, qty) } : l)));
  }

  function removeLine(lineId: string) {
    setError(null); setDraft((prev) => prev.filter((l) => l.lineId !== lineId)); // a fresh edit clears a stale error
  }

  // Applying is local-until-Save, same discipline as PublicCart's own promo
  // field (no validate endpoint) — but unlike the note, the promo error is
  // deliberately NOT cleared by updateQty/removeLine/note's edits above: the
  // rejection is still unresolved even if the diner tweaks something else,
  // so only touching the promo control itself (here) or a fresh Save attempt
  // makes it stale.
  function handleApplyPromo(code: string) {
    setPromoDraft(code); setPromoError(null);
  }

  // "" (not null) — the diner explicitly asked to remove a locally-applied
  // code, so Save must send the explicit-clear key, never "unchanged".
  function handleRemovePromo() {
    setPromoDraft(""); setPromoError(null);
  }

  function discard() {
    setDraft(seedRef.current); setNoteDraft(noteSeedRef.current); setPromoDraft(promoSeedRef.current);
    setError(null); setPromoError(null);
  }

  async function handleSave() {
    if (draft.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    setPromoError(null);
    const body = buildStatusPatchBody({ draft, noteDraft, promoDraft, promoSeed: promoSeedRef.current });
    try {
      const res = await fetch(`/api/public/order-request/${encodeURIComponent(shortCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Feature-guarded exactly like PublicCart's own POST — an older
        // phone simply skips the timeout rather than failing before the save.
        ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? { signal: AbortSignal.timeout(SAVE_TIMEOUT_MS) }
          : {}),
      });
      if (res.status === 200) {
        const envelope = (await res.json().catch(() => null)) as
          | { success: true; data: PublicOrderRequestUpdatedData }
          | null;
        if (!envelope?.success) {
          setError(SAVE_FAILED_MESSAGE);
          setSaving(false);
          return;
        }
        seedRef.current = draft; // clears `dirty` immediately, no poll wait
        noteSeedRef.current = noteDraft.trim();
        setNoteDraft(noteDraft.trim());
        // Same immediate-clear trick as items/note above — keeps whatever
        // was just applied/cleared showing until the NEXT poll tick resets
        // it (promoSeedRef's own comment: there is no server value to hold
        // it against beyond that).
        promoSeedRef.current = promoDraft;
        onAdopt(envelope.data.total, envelope.data.itemCount);
        setSaving(false);
        return;
      }
      const envelope = (await res.json().catch(() => null)) as { success: false; error: string } | null;
      if (res.status === 409) {
        // The server refused this edit. Show its OWN error verbatim and force
        // an immediate re-poll so a status change (locked/cancelled) lands now
        // rather than on the poll's own cadence. The draft is deliberately
        // KEPT: several 409s leave the request "pending" (too old, table
        // changed, save conflict), and silently reverting the lines there left
        // the diner watching their edit vanish with no explanation (review
        // 2026-08-20). When the status really did leave "pending", `editable`
        // goes false and the server's items render instead, so a kept draft is
        // invisible; the next reseed (once not dirty) clears it anyway.
        setError(envelope?.error ?? SAVE_FAILED_MESSAGE);
        setSaving(false);
        onForceRepoll();
        return;
      }
      // A promo rejection is surfaced ON THE FIELD, verbatim, never folded
      // into the generic banner — and keeps the draft (items/note) exactly
      // like the 409 branch above, just without forcing a repoll.
      // Classified by the MESSAGE, never by whether the diner touched the
      // control: the server re-resolves a STORED code against the new
      // subtotal, so lowering a quantity can push an untouched promo under
      // its minimum. Gating on "touched" sent that reason into the generic
      // banner with a useless "refresh the menu" hint (review 2026-08-20).
      if (res.status === 422 && envelope?.error && isPromoErrorMessage(envelope.error)) {
        // Only a code the diner just typed is rolled back; an untouched
        // stored one stays on screen so Remove is the obvious next tap.
        if (promoDraft !== promoSeedRef.current) setPromoDraft(promoSeedRef.current);
        setPromoError(envelope.error);
      } else {
        setError(classifyStatusSaveFailure(res.status, envelope?.error));
      }
      setSaving(false);
    } catch (e) {
      setError(classifySaveError(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="divide-y rounded-lg border">
        {editable && draft.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No items in this order.</p>
        ) : (
          (editable ? draft : items).map((line, i) => (
            <StatusItemRow
              key={editable ? (line as DraftLine).lineId : `${line.productId}-${i}`}
              line={line}
              controls={
                editable
                  ? {
                      onIncrement: () => updateQty((line as DraftLine).lineId, line.qty + 1),
                      onDecrement: () => updateQty((line as DraftLine).lineId, line.qty - 1),
                      onRemove: () => removeLine((line as DraftLine).lineId),
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>

      {editable ? (
        <div className="space-y-1">
          <Label htmlFor="public-status-note">Note for the kitchen (optional)</Label>
          <Input
            id="public-status-note"
            className="text-base"
            value={noteDraft}
            // a fresh edit makes any previous save error stale
            onChange={(e) => { setError(null); setNoteDraft(e.target.value); }}
            maxLength={PUBLIC_NOTE_MAX_LEN}
          />
        </div>
      ) : (
        note && <p className="text-xs italic text-muted-foreground">Note: {note}</p>
      )}

      {editable && (
        <PublicPromoField
          code={promoCodeDisplay}
          // Never known here either (GET/PATCH carry no discount figure) —
          // The server's own figure — the client never computes money. Only
          // meaningful for a code the server has actually accepted, so a
          // just-typed, not-yet-saved code shows the "at the counter" copy.
          savedAmount={promoDraft === (promoCode ?? null) ? (quotedDiscount ?? 0) : 0}
          error={promoError}
          busy={saving}
          onApply={handleApplyPromo}
          onRemove={handleRemovePromo}
        />
      )}

      {status === "accepted" && <p className="text-sm text-muted-foreground">{ACCEPTED_EDIT_NOTICE}</p>}

      {editable && draft.length === 0 && <p className="text-xs text-muted-foreground">{EMPTY_DRAFT_HINT}</p>}

      {editable && error && <p className="text-sm text-destructive">{error}</p>}

      {editable && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 space-y-2 border-t bg-background p-3 animate-in slide-in-from-bottom-4 duration-300">
          <Button className="w-full" size="lg" disabled={saving || draft.length === 0} onClick={handleSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            onClick={discard}
            disabled={saving}
          >
            Discard changes
          </button>
        </div>
      )}
    </div>
  );
}
