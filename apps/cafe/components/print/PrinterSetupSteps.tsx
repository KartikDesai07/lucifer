"use client";

// Print-standardization plan §B2 (slice A2) — the five wizard steps as small,
// prop-driven sections, split out of PrinterSetupWizard.tsx to keep that file
// under its 200-line budget (300-line rule: split, never squeeze). No state
// of its own — every value is derived by the wizard and passed down.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrintHostState } from "@pos/shared/print-job";
import { WIZARD_STEPS, WIZARD_TROUBLESHOOTING, CHROME_PATHS, EDGE_PATHS, shortcutTargetString } from "@/lib/print-host-setup";

function StepCard({ index, children }: { index: number; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{WIZARD_STEPS[index].title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

export function DeviceCheckStep({ isMobile, printHost }: { isMobile: boolean; printHost: PrintHostState | null }) {
  return (
    <StepCard index={0}>
      <p className="text-muted-foreground">{WIZARD_STEPS[0].body}</p>
      {isMobile ? (
        <p className="text-muted-foreground">From this phone or tablet you can still take orders, see the print status and, if needed, remove the print host.</p>
      ) : printHost?.configured ? (
        <div className="flex items-center gap-2">
          <span>Current host: {printHost.label}</span>
          <Badge variant={printHost.offline ? "destructive" : "default"}>{printHost.offline ? "Offline" : "Online"}</Badge>
        </div>
      ) : (
        <p className="text-muted-foreground">No print host is set yet.</p>
      )}
      {!isMobile && <p className="text-xs text-muted-foreground">Designating below replaces the current host.</p>}
    </StepCard>
  );
}

export type DesignateStepProps = { label: string; maxLength: number; onLabelChange: (value: string) => void; onSave: () => void; isPending: boolean; isCurrentHost: boolean; hasDevice: boolean };

export function DesignateStep({ label, maxLength, onLabelChange, onSave, isPending, isCurrentHost, hasDevice }: DesignateStepProps) {
  return (
    <StepCard index={1}>
      <p className="text-muted-foreground">{WIZARD_STEPS[1].body}</p>
      {isCurrentHost && <p className="text-green-600">This PC is already the print host ✓</p>}
      {!hasDevice && <p className="text-xs text-destructive">Could not create a device identity — check the browser&apos;s storage and privacy settings, then reopen this page.</p>}
      <Input value={label} onChange={(e) => onLabelChange(e.target.value)} maxLength={maxLength} placeholder="Counter PC" aria-label="Host label" />
      <Button onClick={onSave} disabled={isPending || label.trim() === "" || !hasDevice}>
        {isCurrentHost ? "Re-save / Replace" : "Save"}
      </Button>
    </StepCard>
  );
}

export type KioskShortcutStepProps = { origin: string; onDownload: () => void; onCopy: () => void };

export function KioskShortcutStep({ origin, onDownload, onCopy }: KioskShortcutStepProps) {
  return (
    <StepCard index={2}>
      <p className="text-muted-foreground">{WIZARD_STEPS[2].body}</p>
      <Button onClick={onDownload}>Download POS Printer setup</Button>
      <p className="text-xs text-muted-foreground">The browser may warn about the .bat download — choose Keep.</p>
      <p className="font-medium">Manual fallback</p>
      <pre className="overflow-x-auto rounded-md border bg-muted p-2 font-mono text-xs">{shortcutTargetString(origin, CHROME_PATHS[0])}</pre>
      <Button variant="outline" size="sm" onClick={onCopy}>Copy</Button>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Right-click the Desktop → New → Shortcut</li>
        <li>Paste this into Target</li>
        <li>Name it &quot;POS Printer&quot;</li>
      </ol>
      <p className="text-xs text-muted-foreground">If Chrome is installed for this user only, the path is: {CHROME_PATHS[2]}</p>
      <p className="text-xs text-muted-foreground">If you use Edge, change the path to: {EDGE_PATHS[0]}</p>
    </StepCard>
  );
}

export function SilentStatusStep({ silentMode }: { silentMode: boolean }) {
  return (
    <StepCard index={3}>
      <p className="text-muted-foreground">{WIZARD_STEPS[3].body}</p>
      {silentMode ? (
        <p className="text-green-600">Silent printing confirmed ✓</p>
      ) : (
        <p className="text-amber-600">Not confirmed yet — run a test print from the Print host card above and answer whether a dialog appeared.</p>
      )}
    </StepCard>
  );
}

export type DoneStepProps = { hostSet: boolean; hostLabel: string | null; shortcutReady: boolean; onShortcutReadyChange: (checked: boolean) => void; silentReady: boolean };

export function DoneStep({ hostSet, hostLabel, shortcutReady, onShortcutReadyChange, silentReady }: DoneStepProps) {
  return (
    <StepCard index={4}>
      <ul className="space-y-1">
        <li>{hostSet ? "✓" : "○"} Host set{hostSet && hostLabel ? ` (${hostLabel})` : ""}</li>
        <li className="flex items-center gap-2">
          <Checkbox checked={shortcutReady} onCheckedChange={(c) => onShortcutReadyChange(c === true)} aria-label="Shortcut ready" />
          Shortcut ready
        </li>
        <li>{silentReady ? "✓" : "○"} Silent print</li>
      </ul>
      <details>
        <summary className="cursor-pointer font-medium">Troubleshooting</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {WIZARD_TROUBLESHOOTING.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </details>
    </StepCard>
  );
}
