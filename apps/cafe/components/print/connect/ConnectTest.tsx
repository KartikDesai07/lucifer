"use client";

import { useEffect } from "react";
import { Check, ChevronRight, ReceiptText } from "lucide-react";

import { PaperSizeToggle } from "@/components/print/PaperSizeToggle";
import {
  PRINTER_BUTTON_FIX_CLASS,
  PRINTER_CONNECT_ANSWER_CLASS,
  PRINTER_CONNECT_ANSWERS_CLASS,
  PRINTER_CONNECT_BIG_CLASS,
  PRINTER_CONNECT_BIG_HEAD_CLASS,
  PRINTER_CONNECT_CARD_BODY_CLASS,
  PRINTER_CONNECT_CARD_CLASS,
  PRINTER_CONNECT_CIRCLE_CLASS,
  PRINTER_CONNECT_HEADING_CLASS,
  PRINTER_CONNECT_LINK_ROW_CLASS,
  PRINTER_CONNECT_NOTE_CLASS,
  PRINTER_CONNECT_TIPS_CLASS,
  PRINTER_STATUS_LINK_CLASS,
  PRINTER_STATUS_STEP_CLASS,
  PRINTER_STATUS_STEP_NUM_CLASS,
  PRINTER_TILE_NEUTRAL_CLASS,
  PRINTER_TILE_OK_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { useTestPrint } from "@/hooks/use-test-print";
import type { PaperWidth } from "@/lib/constants";
import { CONNECT_WORDS, connectedWordsOf, printingWorksWordsOf, type ConnectEvent, type ConnectState } from "@/lib/printer/connect-flow";
import { devicePrinter } from "@/lib/printer/device-printer";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";
import { cn } from "@/lib/utils";

// The guided connect's last steps (PX-3 Task 11, spec §6.7 items 4–6; mockups g4–g6): connected (the green check, Paper
// width and Print a test slip, or in add mode the manager's line, X4), the test slip's question (Yes / No) and, after No,
// the tips with the paper toggle, the test again and another printer. ConnectTestView is props only; ConnectTest wires
// today's test print (hooks/use-test-print.ts: on the printing device the answer files today's attestation).

export interface ConnectTestViewProps {
  step: "connected" | "question" | "tips";
  mode: "replace" | "add";
  name: string;
  /** This device's printer's paper; null where there is none to set (add mode). */
  paper: PaperWidth | null;
  paperDisabled: boolean;
  /** Only where a test proves something (useTestPrint's rule). */
  testable: boolean;
  printing: boolean;
  startDisabled: boolean;
  /** The answer is being filed (the printing device's attestation). */
  answering: boolean;
  onPaper(paper: PaperWidth): void;
  onTest(): void;
  onSkip(): void;
  onYes(): void;
  onNo(): void;
  onOther(): void;
}

export function ConnectTestView({ step, mode, name, paper, paperDisabled, testable, printing, startDisabled, answering, onPaper, onTest, onSkip, onYes, onNo, onOther }: ConnectTestViewProps) {
  const toggle = paper !== null && <PaperSizeToggle value={paper} disabled={paperDisabled} onChange={onPaper} />;
  const testButton = (words: string) =>
    testable && (
      <Button type="button" className={PRINTER_BUTTON_FIX_CLASS} disabled={startDisabled} onClick={onTest}>
        {printing ? CONNECT_WORDS.printing : words}
      </Button>
    );
  if (step === "question") {
    return (
      <>
        <div className={PRINTER_CONNECT_BIG_CLASS}>
          <span aria-hidden="true" className={cn(PRINTER_CONNECT_CIRCLE_CLASS, PRINTER_TILE_NEUTRAL_CLASS)}>
            <ReceiptText />
          </span>
          <p className={PRINTER_CONNECT_HEADING_CLASS}>{CONNECT_WORDS.came}</p>
        </div>
        <div className={PRINTER_CONNECT_ANSWERS_CLASS}>
          <Button type="button" className={PRINTER_CONNECT_ANSWER_CLASS} disabled={answering} onClick={onYes}>
            {CONNECT_WORDS.yes}
          </Button>
          <Button type="button" className={PRINTER_CONNECT_ANSWER_CLASS} variant="outline" disabled={answering} onClick={onNo}>
            {CONNECT_WORDS.no}
          </Button>
        </div>
      </>
    );
  }
  if (step === "tips") {
    return (
      <>
        <h3 className={PRINTER_CONNECT_HEADING_CLASS}>{CONNECT_WORDS.fix}</h3>
        <div className={cn(PRINTER_CONNECT_CARD_CLASS, PRINTER_CONNECT_CARD_BODY_CLASS)}>
          <ol className={PRINTER_CONNECT_TIPS_CLASS}>
            {CONNECT_WORDS.tips.map((tip, i) => (
              <li key={tip} className="flex flex-col gap-2">
                <span className={PRINTER_STATUS_STEP_CLASS}>
                  <span aria-hidden="true" className={PRINTER_STATUS_STEP_NUM_CLASS}>
                    {i + 1}
                  </span>
                  <span>{tip}</span>
                </span>
                {/* "Try the other paper width.": the toggle under it, in line with its words. */}
                {i === CONNECT_WORDS.tips.length - 1 && toggle !== false && <div className="pl-8">{toggle}</div>}
              </li>
            ))}
          </ol>
        </div>
        {testButton(CONNECT_WORDS.again)}
        <div className={PRINTER_CONNECT_LINK_ROW_CLASS}>
          <button type="button" className={PRINTER_STATUS_LINK_CLASS} onClick={onOther}>
            {CONNECT_WORDS.other}
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div role="status" className={PRINTER_CONNECT_BIG_CLASS}>
        <span aria-hidden="true" className={cn(PRINTER_CONNECT_CIRCLE_CLASS, PRINTER_TILE_OK_CLASS)}>
          <Check strokeWidth={2.4} />
        </span>
        <p className={PRINTER_CONNECT_BIG_HEAD_CLASS}>{connectedWordsOf(name)}</p>
      </div>
      {mode === "add" ? (
        <p className={PRINTER_CONNECT_NOTE_CLASS}>{CONNECT_WORDS.addedNote}</p>
      ) : (
        <>
          {(toggle !== false || testable) && (
            <div className={cn(PRINTER_CONNECT_CARD_CLASS, PRINTER_CONNECT_CARD_BODY_CLASS)}>
              {toggle}
              {testButton(CONNECT_WORDS.printTest)}
            </div>
          )}
          <div className={PRINTER_CONNECT_LINK_ROW_CLASS}>
            <button type="button" className={PRINTER_STATUS_LINK_CLASS} onClick={onSkip}>
              {CONNECT_WORDS.skip}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** The container: today's test print and this device's printer. The question comes once the slip went out (the test's
 *  own phase says so); a test the bridge refused (busy, or a failure it toasts) leaves the step as it was, so nobody is
 *  asked about a slip that never printed. */
export function ConnectTest({ state, send, noun, onLeave }: { state: ConnectState; send(event: ConnectEvent): void; noun: DeviceNoun; onLeave(to: "status" | "settings"): void }) {
  const test = useTestPrint();
  const { printer, status } = useDevicePrinter();
  useEffect(() => {
    if (test.phase === "confirm") send({ type: "tested" });
  }, [test.phase, send]);
  const step = state.step === "question" || state.step === "tips" ? state.step : "connected";
  return (
    <ConnectTestView
      step={step}
      mode={state.mode}
      name={state.target?.name ?? ""}
      paper={state.mode === "replace" ? (printer?.paper ?? null) : null}
      paperDisabled={status === "elsewhere"}
      testable={test.testable}
      printing={test.phase === "printing"}
      startDisabled={test.startDisabled}
      answering={test.attesting}
      onPaper={(next) => devicePrinter().setPaper(next)}
      onTest={() => void test.start()}
      onSkip={() => onLeave("status")}
      onYes={() => void test.answer(true, printingWorksWordsOf(noun)).then(() => onLeave("status"))}
      onNo={() => void test.answer(false).then(() => send({ type: "not-printed" }))}
      onOther={() => send({ type: "other" })}
    />
  );
}
