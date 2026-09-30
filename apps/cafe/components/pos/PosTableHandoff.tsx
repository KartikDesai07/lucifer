"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTables, refreshTablesNow } from "@/hooks/use-tables";
import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { takePosTableHandoff } from "@/lib/pos-table-handoff";
import { OPEN_TABS_FILTERS, handoffPickAction } from "@/lib/table-pick";
import type { Order, Table } from "@/types";

// The longest New Order waits for the floor and the open bills before it gives
// up and tells the operator to pick the table by hand.
export const DEEP_LINK_MAX_WAIT_MS = 15_000;
const CLOSE_TAB_MESSAGE = "Close the open tab first, then pick the table.";
const OPEN_BILLS_MESSAGE = "Could not load open bills. Pick the table from the table button.";

type Outcome = { kind: "wait" } | { kind: "act"; run: () => void } | { kind: "refuse" | "fail"; message: string };

const timeoutMessage = (t: string) => `Could not open ${t}. Check the connection, then pick it from the table button.`;

interface ResolverProps {
  tableNo: string;
  resumedOrder: Order | null;
  onResume: (order: Order) => void;
  onSelect: (tableNo: string) => void;
  onDone: () => void;
}

// tabs undefined = the open bills are not confirmed yet; cachedTabs = whatever
// the shared open-tabs cache already held (the floor's view), unconfirmed.
interface JudgeInput extends Pick<ResolverProps, "tableNo" | "resumedOrder" | "onResume" | "onSelect"> {
  list: Table[] | undefined;
  tabs: Order[] | undefined;
  cachedTabs: Order[] | undefined;
  tabsFailed: boolean;
  timedOut: boolean;
}

// What the hand-off should do right now. "refuse" = a refusal that must be
// re-checked against a fresh floor read before the operator is told no.
function judge(i: JudgeInput): Outcome {
  const t = i.tableNo;
  if (i.resumedOrder !== null) return { kind: "fail", message: CLOSE_TAB_MESSAGE };
  if (i.list === undefined) return i.timedOut ? { kind: "fail", message: timeoutMessage(t) } : { kind: "wait" };
  const table = i.list.find((x) => x.tableNo === t);
  if (!table) return { kind: "refuse", message: `Table ${t} is not on the floor plan. It may have been renamed or removed.` };
  const pick = handoffPickAction(table, i.tabs, i.cachedTabs);
  switch (pick.kind) {
    case "select": return { kind: "act", run: () => i.onSelect(t) };
    case "resume": { const tab = pick.tab; return { kind: "act", run: () => i.onResume(tab) }; }
    case "wait": return i.tabsFailed || i.timedOut ? { kind: "fail", message: OPEN_BILLS_MESSAGE } : { kind: "wait" };
    case "unavailable": {
      const why = pick.reason === "reserved" ? "is reserved" : "is marked occupied but has no open bill";
      return { kind: "refuse", message: `${t} ${why}. Free it on the Tables floor first.` };
    }
  }
}

// Mounted only while a hand-off is pending, so its two queries and its timer
// exist for that wait alone. Resolves once, then asks to be unmounted.
function HandoffResolver({ tableNo, resumedOrder, onResume, onSelect, onDone }: ResolverProps) {
  const qc = useQueryClient();
  const tables = useTables();
  const tabs = useOrders(OPEN_TABS_FILTERS, OPEN_TABS_QUERY_OPTIONS);
  const [timedOut, setTimedOut] = useState(false);
  // null = no fresh floor read yet; { list: undefined } = the read failed.
  const [fresh, setFresh] = useState<{ list: Table[] | undefined } | null>(null);
  const aliveRef = useRef(true);
  const finishedRef = useRef(false);
  const refreshStartedRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    const id = setTimeout(() => setTimedOut(true), DEEP_LINK_MAX_WAIT_MS);
    return () => { aliveRef.current = false; clearTimeout(id); };
  }, []);

  // A paused (offline) query is never ready and never empty: the timer above
  // bounds the wait instead.
  const tablesReady = tables.data !== undefined && tables.fetchStatus === "idle";
  const tabsSettled = tabs.isFetchedAfterMount && tabs.fetchStatus === "idle";
  const tabsReady = tabsSettled && !tabs.isError;
  const tabsFailed = tabsSettled && tabs.isError;
  const [tabList, floor] = [tabs.data, tables.data];

  useEffect(() => {
    if (finishedRef.current) return;
    const list = fresh?.list ?? (tablesReady ? floor : undefined);
    const knownTabs = tabsReady ? tabList : undefined;
    let verdict = judge({ tableNo, list, tabs: knownTabs, cachedTabs: tabList, tabsFailed, timedOut, resumedOrder, onResume, onSelect });
    if (verdict.kind === "wait") return;
    if (verdict.kind === "refuse" && fresh === null) {
      // Out of time: the connection message, not a refusal we could not verify.
      if (!timedOut) {
        if (!refreshStartedRef.current) {
          refreshStartedRef.current = true;
          refreshTablesNow(qc)
            .catch(() => undefined)
            .then((next) => {
              if (aliveRef.current) setFresh({ list: next });
            });
        }
        return;
      }
      verdict = { kind: "fail", message: timeoutMessage(tableNo) };
    } else if (verdict.kind === "refuse" && fresh?.list === undefined) {
      // The re-check read failed: the refusal rests on the unverified cached
      // floor, so say the connection failed instead of a "no" we cannot back.
      verdict = { kind: "fail", message: timeoutMessage(tableNo) };
    }
    finishedRef.current = true;
    if (verdict.kind === "act") verdict.run();
    else toast.error(verdict.message);
    onDone();
  }, [qc, tableNo, floor, fresh, tablesReady, tabList, tabsReady, tabsFailed, timedOut, resumedOrder, onResume, onSelect, onDone]);

  return null;
}

interface PosTableHandoffProps {
  resumedOrder: Order | null;
  onResume: (order: Order) => void;
  onSelect: (tableNo: string | undefined) => void;
}

// Applies the table the Tables floor handed over (lib/pos-table-handoff.ts):
// resume its open bill, or pick it for a new order, or say plainly why not.
// Renders nothing. The take happens once, in a mount effect that never sets
// null, so a StrictMode double run finds the store already emptied.
export function PosTableHandoff({ resumedOrder, onResume, onSelect }: PosTableHandoffProps) {
  const [wanted, setWanted] = useState<string | null>(null);

  useEffect(() => {
    const t = takePosTableHandoff(Date.now());
    if (t) setWanted(t);
  }, []);

  const onDone = useCallback(() => setWanted(null), []);

  if (wanted === null) return null;
  return (
    <HandoffResolver
      tableNo={wanted}
      resumedOrder={resumedOrder}
      onResume={onResume}
      onSelect={onSelect}
      onDone={onDone}
    />
  );
}
