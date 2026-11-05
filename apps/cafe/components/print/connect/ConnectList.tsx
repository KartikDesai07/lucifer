"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { FindNetworkPrinters } from "@/components/print/FindNetworkPrinters";
import { marked } from "@/components/print/PrinterStatusCard";
import { PRINTER_BUTTON_CLASS, PRINTER_BUTTON_PRIMARY_CLASS, PRINTER_CONNECT_BUTTON_CLASS, PRINTER_CONNECT_CARD_BODY_CLASS, PRINTER_CONNECT_CARD_CLASS, PRINTER_CONNECT_ERROR_CLASS, PRINTER_CONNECT_ROW_CLASS, PRINTER_CONNECT_SEARCHING_CLASS, PRINTER_CONNECT_SPIN_CLASS, PRINTER_CONNECT_STEPS_CLASS, PRINTER_ERROR_CLASS, PRINTER_FIELD_TALL_CLASS, PRINTER_HERE_DOT_CLASS, PRINTER_HERE_NAME_CLASS, PRINTER_HERE_SUB_CLASS, PRINTER_HERE_TONE, PRINTER_LABEL_CLASS, PRINTER_NOTE_CLASS, PRINTER_NOTICE_CLASS, PRINTER_SECTION_TITLE_CLASS, PRINTER_STATUS_STEP_CLASS, PRINTER_STATUS_STEP_NUM_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { networkTargetOf, useNativePrinterList } from "@/hooks/use-native-printer-list";
import { CONNECT_WORDS, connectRowsOf, type ConnectRow, type ConnectTransport } from "@/lib/printer/connect-flow";
import { DEFAULT_TCP_PRINTER_PORT, type NativeBluetoothState } from "@/lib/printer/native-bridge-protocol";
import { canScanBluetooth } from "@/lib/printer/native-picker-state";
import { splitHostPort } from "@/lib/printer/network-address";
import { nativeErrorMessage, type NativeSelectTarget } from "@/lib/printer/transport-native";
import { cn } from "@/lib/utils";

// Step 2 of the guided connect (PX-3 Task 11, spec §6.7 item 2; mockup g2): the printers the POS app can see. Bluetooth:
// the paired ones at once, then the app's scan starts by itself ("Looking for more printers…"), each row a Connect (the
// first paired one primary), and "Not in the list?". USB: its printers and Refresh. Wi-Fi or network: today's form. A
// failed connect says why above the rows. ConnectListView and NetworkFormView are props only; ConnectList wires the app's
// list (hooks/use-native-printer-list.ts, the old picker's logic) and the form's fields.

const BLUETOOTH_UNSUPPORTED_MESSAGE = "This device has no Bluetooth. You can still use a USB or network printer.";
const BLUETOOTH_OFF_LINE = "Bluetooth is off on this device.";
const BLUETOOTH_BLOCKED_LINE = "The POS app needs permission to use Bluetooth.";
const NETWORK_TITLE = "Network printer (Wi-Fi or Ethernet)";
const OTG_NOTE = "USB connects directly to this phone or tablet using OTG. A printer cabled to a PC must be selected in the POS desktop app on that PC.";
const LINE_CLASS = "text-[13.5px] text-muted-foreground";

export interface ConnectListViewProps {
  transport: "bluetooth" | "usb";
  /** The flow's line after a failed connect. */
  error: string | null;
  /** null while the first list is read. */
  rows: ConnectRow[] | null;
  bluetooth: NativeBluetoothState | null;
  scanning: boolean;
  /** Why the last scan did not list (the app's own words), shown in the list, never a toast. */
  scanError: string | null;
  refreshing: boolean;
  /** Turn on / Allow Bluetooth or a refresh is running: the rows wait. A scan does not hold them (the app stops it to connect). */
  locked: boolean;
  onConnect(row: ConnectRow): void;
  onScan(): void;
  onRefresh(): void;
  onTurnOn(): void;
  onAllow(): void;
}

function ErrorLine({ error }: { error: string | null }) {
  return error === null ? null : <p role="alert" className={PRINTER_CONNECT_ERROR_CLASS}>{error}</p>;
}

function Rows({ rows, locked, onConnect }: { rows: ConnectRow[]; locked: boolean; onConnect(row: ConnectRow): void }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id} className={PRINTER_CONNECT_ROW_CLASS}>
          <span aria-hidden="true" className={cn(PRINTER_HERE_DOT_CLASS, PRINTER_HERE_TONE.quiet.dot)} />
          <p className={PRINTER_HERE_NAME_CLASS}>
            {row.name}
            <span className={PRINTER_HERE_SUB_CLASS}>{row.sub}</span>
          </p>
          {/* The visible word first, then the printer (WCAG 2.5.3 label-in-name). */}
          <Button className={PRINTER_CONNECT_BUTTON_CLASS} variant={row.primary ? "default" : "outline"} aria-label={`${CONNECT_WORDS.connect} ${row.name}`} disabled={locked} onClick={() => onConnect(row)}>
            {CONNECT_WORDS.connect}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ConnectListView({ transport, error, rows, bluetooth, scanning, scanError, refreshing, locked, onConnect, onScan, onRefresh, onTurnOn, onAllow }: ConnectListViewProps) {
  const reading = <p role="status" className={LINE_CLASS}>{CONNECT_WORDS.reading}</p>;
  if (transport === "usb") {
    return (
      <>
        <ErrorLine error={error} />
        {rows === null ? reading : rows.length === 0 ? (
          <>
            <p className={LINE_CLASS}>{CONNECT_WORDS.usbNone}</p>
            <p className={PRINTER_NOTE_CLASS}>{OTG_NOTE}</p>
          </>
        ) : (
          <div className={PRINTER_CONNECT_CARD_CLASS}>
            <Rows rows={rows} locked={locked} onConnect={onConnect} />
          </div>
        )}
        <Button className={PRINTER_BUTTON_CLASS} variant="outline" onClick={onRefresh} disabled={scanning || locked}>
          <RefreshCw aria-hidden="true" />
          {refreshing ? CONNECT_WORDS.refreshing : CONNECT_WORDS.refresh}
        </Button>
      </>
    );
  }
  return (
    <>
      <ErrorLine error={error} />
      {bluetooth === "off" && (
        <div role="status" className={PRINTER_NOTICE_CLASS}>
          <p>{BLUETOOTH_OFF_LINE}</p>
          <Button className={PRINTER_BUTTON_CLASS} onClick={onTurnOn} disabled={locked}>
            Turn on Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unauthorized" && (
        <div role="status" className={PRINTER_NOTICE_CLASS}>
          <p>{BLUETOOTH_BLOCKED_LINE}</p>
          <Button className={PRINTER_BUTTON_CLASS} onClick={onAllow} disabled={locked}>
            Allow Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unsupported" && <p role="status" className={PRINTER_NOTICE_CLASS}>{BLUETOOTH_UNSUPPORTED_MESSAGE}</p>}
      {rows === null
        ? reading
        : (rows.length > 0 || scanning || scanError !== null) && (
            <div className={PRINTER_CONNECT_CARD_CLASS}>
              {rows.length > 0 && <Rows rows={rows} locked={locked} onConnect={onConnect} />}
              {scanning ? (
                <p role="status" className={PRINTER_CONNECT_SEARCHING_CLASS}>
                  <span aria-hidden="true" className={PRINTER_CONNECT_SPIN_CLASS} />
                  {CONNECT_WORDS.searching}
                </p>
              ) : (
                scanError !== null && <p role="status" className={PRINTER_CONNECT_SEARCHING_CLASS}>{scanError}</p>
              )}
            </div>
          )}
      {bluetooth !== "unsupported" && (
        <div className={cn(PRINTER_CONNECT_CARD_CLASS, PRINTER_CONNECT_CARD_BODY_CLASS)}>
          <p className={PRINTER_SECTION_TITLE_CLASS}>{CONNECT_WORDS.notListed}</p>
          <ol className={PRINTER_CONNECT_STEPS_CLASS}>
            {CONNECT_WORDS.notListedSteps.map((step, i) => (
              <li key={step} className={PRINTER_STATUS_STEP_CLASS}>
                <span aria-hidden="true" className={PRINTER_STATUS_STEP_NUM_CLASS}>
                  {i + 1}
                </span>
                <span>{marked(step)}</span>
              </li>
            ))}
          </ol>
          <Button className={PRINTER_BUTTON_CLASS} variant="outline" onClick={onScan} disabled={scanning || locked || !canScanBluetooth(bluetooth)}>
            <RefreshCw aria-hidden="true" />
            {CONNECT_WORDS.searchAgain}
          </Button>
        </div>
      )}
    </>
  );
}

export interface NetworkFormViewProps {
  error: string | null;
  address: string;
  port: string;
  /** The form's own check (the address, the port). */
  formError: string | null;
  onAddress(value: string): void;
  onPort(value: string): void;
  onPaste(event: ClipboardEvent<HTMLInputElement>): void;
  onSubmit(): void;
  /** Find network printers (the app's own scan), inside the form before Connect. */
  find?: ReactNode;
}

export function NetworkFormView({ error, address, port, formError, onAddress, onPort, onPaste, onSubmit, find }: NetworkFormViewProps) {
  return (
    <>
      <ErrorLine error={error} />
      <form
        method="post"
        className={cn(PRINTER_CONNECT_CARD_CLASS, PRINTER_CONNECT_CARD_BODY_CLASS)}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <p className={PRINTER_LABEL_CLASS}>{NETWORK_TITLE}</p>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
            <span className={PRINTER_LABEL_CLASS}>Printer address</span>
            <Input value={address} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="192.168.1.50" aria-invalid={formError !== null} onChange={(e) => onAddress(e.target.value)} onPaste={onPaste} className={PRINTER_FIELD_TALL_CLASS} />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className={PRINTER_LABEL_CLASS}>Port</span>
            <Input value={port} inputMode="numeric" autoComplete="off" onChange={(e) => onPort(e.target.value)} className={PRINTER_FIELD_TALL_CLASS} />
          </label>
        </div>
        {formError !== null && <p role="alert" className={PRINTER_ERROR_CLASS}>{formError}</p>}
        {find}
        <Button type="submit" className={PRINTER_BUTTON_PRIMARY_CLASS}>
          {CONNECT_WORDS.connect}
        </Button>
      </form>
    </>
  );
}

type Pick = (target: NativeSelectTarget, name: string) => void;

// Bluetooth and USB: the app's list. The scan starts by itself once, when the first list has answered (spec §6.7 item 2:
// today's 8 s Find printers), and not where Bluetooth is known to be unusable (its notice says why).
function FoundList({ transport, error, onPick }: { transport: "bluetooth" | "usb"; error: string | null; onPick: Pick }) {
  const list = useNativePrinterList();
  const [scanError, setScanError] = useState<string | null>(null);
  const scanned = useRef(false);
  const search = (): void => {
    setScanError(null);
    void list.scan().then((failed) => setScanError(failed === null ? null : nativeErrorMessage(failed)));
  };
  useEffect(() => {
    if (transport !== "bluetooth" || scanned.current || list.printers === null) return;
    scanned.current = true;
    if (canScanBluetooth(list.bluetooth)) search();
  });
  return (
    <ConnectListView
      transport={transport}
      error={error}
      rows={list.printers === null ? null : connectRowsOf(list.printers, transport)}
      bluetooth={list.bluetooth}
      scanning={list.scanning}
      scanError={scanError}
      refreshing={list.refreshing}
      locked={list.working || list.refreshing}
      onConnect={(row) => onPick({ id: row.id }, row.name)}
      onScan={search}
      onRefresh={() => void list.refresh()}
      onTurnOn={() => void list.turnOnBluetooth()}
      onAllow={() => void list.allowBluetooth()}
    />
  );
}

// Wi-Fi or network: today's form, its checks (networkTargetOf) and Find network printers.
function NetworkForm({ error, onPick }: { error: string | null; onPick: Pick }) {
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(DEFAULT_TCP_PRINTER_PORT));
  const [formError, setFormError] = useState<string | null>(null);
  const submit = (): void => {
    const checked = networkTargetOf(address, port);
    setAddress(checked.address);
    setPort(checked.port);
    setFormError(checked.error);
    if (checked.target !== null) onPick(checked.target, `${checked.target.tcp.host}:${checked.target.tcp.port}`);
  };
  return (
    <NetworkFormView
      error={error}
      address={address}
      port={port}
      formError={formError}
      onAddress={(value) => { setAddress(value); setFormError(null); }}
      onPort={(value) => { setPort(value); setFormError(null); }}
      onPaste={(e) => {
        const pasted = splitHostPort(e.clipboardData.getData("text"));
        if (pasted === null) return;
        e.preventDefault();
        setAddress(pasted.host);
        setPort(pasted.port);
      }}
      onSubmit={submit}
      find={<FindNetworkPrinters onPick={(host, picked) => { setAddress(host); setPort(String(picked)); setFormError(null); }} />}
    />
  );
}

/** The list step's container. `hidden` while the app connects: the list stays mounted (its scan, the typed address), so a
 *  failed connect comes back to it as it was, with its line. */
export function ConnectList({ transport, error, hidden, onPick }: { transport: ConnectTransport; error: string | null; hidden: boolean; onPick: Pick }) {
  return (
    <div className={cn("flex flex-col gap-3", hidden && "hidden")}>
      {transport === "network" ? <NetworkForm error={error} onPick={onPick} /> : <FoundList transport={transport} error={error} onPick={onPick} />}
    </div>
  );
}
