"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SettingsGroup, HINT_CLASS } from "@/components/settings/SettingsFields";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";
import { BlockEditor } from "@/components/settings/print-design/BlockEditor";
import { FontPicker } from "@/components/settings/print-design/FontPicker";
import {
  loadSlipCode,
  slipCodeStatus,
  subscribeSlipCode,
  templateNeedsSlipCode,
} from "@/components/print/slip/slip-code";
import { usePrintFontsPreload } from "@/hooks/use-print-fonts-preload";
import type { SlipDesignDraft } from "@/hooks/use-slip-design-draft";
import { PRINT_FONT_SIZES } from "@/lib/constants";
import { isEdited, setBaseSize, setFont, type EditableTemplate } from "@/lib/print-design-editor";
import type { EditorKind } from "@/lib/print-design-kinds";
import { PREVIEW_LOAD_FAILED_TEXT } from "@/lib/print-design-labels";
import type { Settings } from "@/types";

type Pending<D extends string> = { kind: "switch"; design: D } | { kind: "reset" } | { kind: "today" } | null;

// The shadcn Button never wraps (whitespace-nowrap); these long labels must, or they overflow a 360px screen.
const RECOVERY_BUTTON_CLASS = "h-auto min-h-11 whitespace-normal text-left";

/** What a kind's gallery gets: the design being edited (null = today's slip), the page's sample date, and the pick. */
export interface GalleryArgs<D extends string> {
  active: D | null;
  createdAt: string;
  onPick: (design: D) => void;
}

interface DesignSectionProps<T extends EditableTemplate> {
  kind: EditorKind<T>;
  design: SlipDesignDraft<T>;
  /** The SAVED settings. */
  settings: Settings;
  /** The saved settings with the form's live legacy toggles laid over them, read at click time: what Classic starts from. */
  legacy: () => Settings;
  gallery: (args: GalleryArgs<T["design"]>) => ReactNode;
}

/** "Couldn't load the design preview" + Try again: shown while the draft needs the lazy slip chunk and it failed. */
export function PreviewLoadNotice({
  template,
  needsCode = templateNeedsSlipCode,
}: {
  template: { design: string; blocks: readonly { type: string }[] } | null;
  /** What makes this slip need the lazy chunk (the token slip: a QR line only; its designs are eager). */
  needsCode?: (template: { design: string; blocks: readonly { type: string }[] }) => boolean;
}) {
  const status = useSyncExternalStore(subscribeSlipCode, slipCodeStatus, slipCodeStatus);
  if (template === null || status !== "failed" || !needsCode(template)) return null;
  return (
    <div role="alert" className="mb-3 space-y-2 rounded-lg border border-destructive p-3 text-sm text-brand-ink">
      <p>{PREVIEW_LOAD_FAILED_TEXT}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadSlipCode()}>
        Try again
      </Button>
    </div>
  );
}

function confirmCopyOf<T extends EditableTemplate>(
  kind: EditorKind<T>,
  pending: Exclude<Pending<T["design"]>, null>,
  current: T["design"] | null,
): { title: string; description: string; confirmLabel: string } {
  switch (pending.kind) {
    case "switch":
      return {
        title: `Switch to ${kind.designLabel[pending.design]}?`,
        description: "You changed lines in this design. Switching starts the new design from its own lines and drops those changes.",
        confirmLabel: "Switch design",
      };
    case "reset":
      return {
        title: `Reset ${current ? kind.designLabel[current] : "this design"}?`,
        description: "Every change you made to this design is dropped and its lines start again.",
        confirmLabel: "Reset design",
      };
    case "today":
      return kind.copy.backToTodayConfirm;
  }
}

// The slip designs: the gallery, then (once one is picked) every line of the slip and its font and size. Every
// change is only the unsaved draft; the page's one Save bar saves it with the rest of the form.
export function DesignSection<T extends EditableTemplate>({ kind, design, settings, legacy, gallery }: DesignSectionProps<T>) {
  const { draft } = design;
  const { copy } = kind;
  // Reading `design` off a generic template widens it to string, so it is typed once here.
  const current = (draft?.design ?? null) as T["design"] | null;
  const [pending, setPending] = useState<Pending<T["design"]>>(null);
  // One sample date for every thumbnail, fixed for the life of the page so the sample's time never ticks.
  const [createdAt] = useState(() => new Date().toISOString());
  usePrintFontsPreload(kind.withDraft(settings, draft));

  const edited = draft !== null && isEdited(kind.spec, draft, legacy());

  const pick = (next: T["design"]) => {
    // The design printed today (Classic, or Big number for the token slip) is current until "Customize" is pressed;
    // tapping the design already being edited does nothing.
    if (draft === null ? next === kind.todayDesign : next === draft.design) return;
    if (edited) setPending({ kind: "switch", design: next });
    else design.activate(next, legacy());
  };

  const confirm = () => {
    if (pending === null) return;
    if (pending.kind === "switch") design.activate(pending.design, legacy());
    else if (pending.kind === "reset" && draft !== null) design.activate(draft.design, legacy());
    else if (pending.kind === "today") design.backToToday();
    setPending(null);
  };

  return (
    <div className="space-y-6">
      <SettingsGroup stacked title={copy.sectionTitle} description={copy.sectionDescription}>
        {design.unreadable && (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive p-3 text-sm text-brand-ink">
            <p>{copy.unreadable}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className={RECOVERY_BUTTON_CLASS} onClick={() => design.recoverClassic(legacy())}>
                {copy.recoverClassicLabel}
              </Button>
              <Button type="button" variant="outline" className={RECOVERY_BUTTON_CLASS} onClick={design.keepToday}>
                {copy.keepTodayLabel}
              </Button>
            </div>
          </div>
        )}
        {design.notices.map((notice) => (
          <p key={notice} role="status" className="rounded-lg border border-brand-rule bg-brand-wash p-3 text-sm text-brand-ink">
            {notice}
          </p>
        ))}
        {gallery({ active: current, createdAt, onPick: pick })}
        {draft === null ? (
          <div className="space-y-2">
            <Button type="button" className="min-h-11" onClick={() => design.activate(kind.todayDesign, legacy())}>
              {copy.customizeLabel}
            </Button>
            <p className={HINT_CLASS}>{copy.customizeHint}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => (edited ? setPending({ kind: "reset" }) : design.activate(draft.design, legacy()))}>
              Reset to {kind.designLabel[current as T["design"]]}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setPending({ kind: "today" })}>
              {copy.backToTodayLabel}
            </Button>
          </div>
        )}
      </SettingsGroup>

      {draft !== null && (
        <>
          <SettingsGroup stacked title={copy.linesTitle} description={copy.linesDescription}>
            <BlockEditor kind={kind} template={draft} settings={settings} issues={design.issues} onChange={design.set} />
          </SettingsGroup>
          <SettingsGroup stacked title="Font and text size" description="The base face and size every line is scaled from.">
            <FontPicker value={draft.font} onChange={(font) => design.set(setFont(draft, font))} />
            <PrintSizeChoice
              legend="Text size"
              options={PRINT_FONT_SIZES}
              value={draft.size}
              onChange={(size) => design.set(setBaseSize(draft, size))}
            />
          </SettingsGroup>
        </>
      )}

      {pending !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          {...confirmCopyOf(kind, pending, current)}
          destructive={false}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}
