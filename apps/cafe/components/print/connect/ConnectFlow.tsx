"use client";

import { useEffect, useRef } from "react";

import { ConnectList } from "@/components/print/connect/ConnectList";
import { ConnectProgress } from "@/components/print/connect/ConnectProgress";
import { ConnectTest } from "@/components/print/connect/ConnectTest";
import { ConnectType } from "@/components/print/connect/ConnectType";
import { PanelBackIcon } from "@/components/print/PrinterPanelFrame";
import {
  PRINTER_PANEL_BACK_CLASS,
  PRINTER_PANEL_CANCEL_CLASS,
  PRINTER_PANEL_DONE_CLASS,
  PRINTER_PANEL_HEAD_ROW_CLASS,
  PRINTER_PANEL_HEAD_TEXT_CLASS,
  PRINTER_PANEL_SUB_CLASS,
  PRINTER_PANEL_VIEW_TITLE_CLASS,
} from "@/components/print/printer-classes";
import { useConnectAttempt } from "@/hooks/use-connect-attempt";
import { CONNECT_BACK_LABEL, CONNECT_TITLE, attemptErrorWordsOf, connectHeadOf, type ConnectEvent, type ConnectState } from "@/lib/printer/connect-flow";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";
import { nativeTargetId, type NativeSelectTarget } from "@/lib/printer/transport-native";

// The guided connect (PX-3 Task 11, spec §6.7; mockups g1–g6): the Android app's only way to connect, change or add a
// printer (X2). ConnectFlow draws the step the state names and makes the one call a tap asks for (useConnectAttempt:
// today's replace and add); the steps are props-only views over their containers. onLeave: Skip and Yes go to status.

export interface ConnectFlowProps {
  state: ConnectState;
  send(event: ConnectEvent): void;
  noun: DeviceNoun;
  onLeave(to: "status" | "settings"): void;
}

export function ConnectFlow({ state, send, noun, onLeave }: ConnectFlowProps) {
  const attempt = useConnectAttempt();
  // A connect is never aborted (X3: the bridge has none): one that ends after Back or Cancel finishes as today's would, and
  // only the flow still on screen hears how it ended. One at a time: a second tap before the list hides starts nothing.
  const live = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const pick = (target: NativeSelectTarget, name: string): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    send({ type: "pick", target: { id: nativeTargetId(target), name } });
    const run = state.mode === "add" ? attempt.add(target) : attempt.replace(target);
    // No toast of its own: the step says it. Ruling T11-B: an attempt the app refused (thrown) in its own words; one that
    // ran and did not connect, in the step's.
    void run
      .then(
        (outcome): ConnectEvent => (outcome === "connected" ? { type: "connected" } : { type: "failed" }),
        (error: unknown): ConnectEvent => ({ type: "failed", message: attemptErrorWordsOf(error) }),
      )
      .then((event) => {
        inFlight.current = false;
        if (live.current) send(event);
      });
  };
  const { step, transport } = state;
  // Each step keeps its slot, so the list stays mounted while it connects and the test's state lives through its steps.
  return (
    <>
      {step === "type" && <ConnectType noun={noun} onChoose={(chosen) => send({ type: "choose", transport: chosen })} />}
      {transport !== null && (step === "list" || step === "connecting") && <ConnectList transport={transport} error={state.error} hidden={step === "connecting"} onPick={pick} />}
      {step === "connecting" && <ConnectProgress name={state.target?.name ?? ""} />}
      {(step === "connected" || step === "question" || step === "tips") && <ConnectTest state={state} send={send} noun={noun} onLeave={onLeave} />}
    </>
  );
}

/** /printers (spec §6.1: inline, no frame): the connect view in place of both views, with the frame's head row (the back,
 *  the title, the sub) and its foot's button; the back, Cancel and Done all return to the two views. */
export function ConnectPageView(props: ConnectFlowProps) {
  const { state, onLeave } = props;
  const head = connectHeadOf(state);
  const rowRef = useRef<HTMLDivElement>(null);
  // The page scrolls, not a sheet: the view's head comes into sight and takes the focus, as a view switch does (F-M6).
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
    rowRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, []);
  return (
    <>
      <div ref={rowRef} className={PRINTER_PANEL_HEAD_ROW_CLASS}>
        <button type="button" aria-label={CONNECT_BACK_LABEL} title={CONNECT_BACK_LABEL} className={PRINTER_PANEL_BACK_CLASS} onClick={() => onLeave("settings")}>
          <PanelBackIcon />
        </button>
        <div className={PRINTER_PANEL_HEAD_TEXT_CLASS}>
          <h2 tabIndex={-1} className={PRINTER_PANEL_VIEW_TITLE_CLASS}>
            {CONNECT_TITLE}
          </h2>
          <p className={PRINTER_PANEL_SUB_CLASS}>{head.sub}</p>
        </div>
      </div>
      <ConnectFlow {...props} />
      <button type="button" className={head.foot === "cancel" ? PRINTER_PANEL_CANCEL_CLASS : PRINTER_PANEL_DONE_CLASS} onClick={() => onLeave(head.foot === "cancel" ? "settings" : "status")}>
        {head.foot === "cancel" ? "Cancel" : "Done"}
      </button>
    </>
  );
}
