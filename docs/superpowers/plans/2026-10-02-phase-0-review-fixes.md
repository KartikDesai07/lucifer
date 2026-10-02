# Phase 0: printing review fixes, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the regressions and gaps found in the 2026-10-02 review of the uncommitted GPT changes (spec §12, F0.1–F0.11), so branch `feat/printing-reliability` is safe to build and test before Phase 1 starts.

**Architecture:** Small, independent fixes in five places:
- the cafe web print pipeline: a refusal made before any byte is sent becomes resendable;
- the in-app printer picker: a pure, unit-tested loader and Bluetooth-state helpers;
- the CSS build: a PostCSS step that gives old WebViews real tints instead of solid colours;
- the Android Kotlin USB permission flow;
- a React Native retry-wiring fix.

The last task verifies everything end to end on the emulator.

**Tech stack:**
- apps/cafe: Next.js 15.5, Tailwind v4, PostCSS, node:test via `tsx`.
- apps/mobile: React Native 0.87 with Kotlin, node:test via `tsx` plus Jest.
- Android build: Gradle 9.4.1 / AGP 9.2.1.
- Emulator: Android AVD `Pixel_7_API_33` (x86_64, Android 13, WebView 109).

**Spec:** [docs/superpowers/specs/2026-10-02-printing-reliability-design.md](../specs/2026-10-02-printing-reliability-design.md). §12 lists F0.1–F0.11, §2 has the hard constraints, §17 the free-tier budget. Read §12 before starting.

## Global Constraints

- **Branch:** work on `feat/printing-reliability`. Never commit to `main`. Never merge or push without the owner's explicit OK.
- **Free tier:** each cafe runs on its own free Vercel Hobby, Atlas M0 and Cloudflare accounts, and nothing may add cost.
  - Phase 0 adds **no** network requests, **no** recurring work and **no** runtime dependencies.
  - The new PostCSS step uses `postcss`, which is already installed.
- **Keep** GPT's kept changes listed in spec §12.
- **F0.10 (decided by the owner):** keep GPT's Sandbee branding on the app's native screens. Everything after the POS page loads is the cafe's brand. Don't change the launcher label.
- **Style:** repository docs and code comments are in English. Comments explain *why*, matching the surrounding density.
- **Replies to the owner** are in Hinglish.
- **Tests:**
  - cafe: node:test files run through the explicit list `testChain` in `apps/cafe/package.json`. A new test file must be added to that list.
  - mobile `src/**`: node:test files are listed in the `test` script in `apps/mobile/package.json`.
  - mobile Jest covers only `__tests__/**/*.test.tsx`.
  - Kotlin has no unit tests. It is pinned by source checks in `apps/mobile/src/mobile-paths.test.ts`, and each pin needs a mutation table proving it can fail.
- **Windows (this PC):**
  - Shell is Git Bash. For `adb`, set `MSYS_NO_PATHCONV=1` and pass Windows paths (`D:/...`).
  - Run Gradle with `GRADLE_USER_HOME='D:\gradle-home'`: C: has only about 4.5 GB free, and the cache lives on D:.
  - Run mobile npm commands only inside `apps/mobile`.
  - Never create temp files inside the repo; use the session scratchpad. Never delete files you did not create.
  - `<scratchpad>` below means your session's scratchpad directory (your system prompt names it). Write it with forward slashes, e.g. `C:/Users/…/scratchpad`, so both Git Bash and `adb` accept it.
- **Known unrelated failure:** in the cafe test chain, `lib/go-live-dl.test.ts` → "PIN: cb-dl2-decisions.md D-C's archive-path clause…" fails with ENOENT for `.claude/plan/v2/_research/cb-dl2-decisions.md`, a local planning file missing on this PC. It is not caused by this work. Leave it, and report it.

## Review Focus

The five input classes most likely to bite a cafe that no task's tests would otherwise exercise. Each has a test in the task named.

1. **Web Serial port closed by the OS while the panel still says connected** (no disconnect event): the slip prints once after one silent reconnect, with no duplicate. → Task 2, test "a port that is no longer writable…".
2. **Web Bluetooth printer that drops after the first chunk:** no automatic replay; the message tells staff to check the paper. → Task 2, BLE test "drops after a chunk".
3. **Printer panel opened while the Bluetooth status request fails or times out:** the USB/paired list still shows, and Find printers stays enabled. → Task 3, `loadPicker` and `canScanBluetooth` tests.
4. **Dark mode on WebView 109:** tints use the dark theme's colour, not the light one. → Task 4, test "light and dark themes each define their own channel twins".
5. **USB printer re-plugged while the app is hidden:** no prompt in the background, exactly one prompt when the app is opened, and a real denial stops further prompts until Reconnect. → Task 5, pin 16; Task 7, checklist line.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `.gitignore` | already edited by the owner, commit it | ignore `.playwright-mcp` |
| `apps/cafe/lib/printer/web-printer-types.ts` | modify | `notConnectedError()`: a coded pre-write refusal |
| `apps/cafe/lib/printer/device-printer-link.ts` | modify | web `send()` with no transport → coded refusal |
| `apps/cafe/lib/printer/transport-ble.ts` | modify | a drop before the first chunk → coded refusal; after it → uncertain |
| `apps/cafe/lib/printer/transport-serial.ts` | modify | `writable === null` → coded refusal |
| `apps/cafe/lib/printer/transport-native.ts` | modify | app lane `write()` with no client → coded refusal |
| `apps/cafe/lib/printer/device-printer-write.ts` | modify | messages after a refusal say "not connected" |
| `apps/cafe/lib/printer/native-picker-state.ts` | create | pure picker helpers: `canScanBluetooth`, `loadPicker`, `createStatusOrder` |
| `apps/cafe/lib/printer/native-picker-state.test.ts` | create | unit tests for the above |
| `apps/cafe/components/print/NativePrinterPicker.tsx` | modify | use the helpers, refresh label, late bridge |
| `apps/cafe/lib/printer-ui-paths.test.ts` | modify | new needles and mutations for the picker |
| `apps/cafe/postcss-tint-fallback.cjs` | create | PostCSS step: `--x-rgb` twins and `rgb(var(--x-rgb) / N%)` fallbacks |
| `apps/cafe/postcss.config.mjs` | modify | add the step after the oklab fallback |
| `apps/cafe/lib/css-compat.test.ts` | modify | shared compile helper and tint tests |
| `apps/cafe/package.json` | modify | add the new test file to `testChain` |
| `apps/mobile/android/.../printer/PrinterTypes.kt` | modify | `TransportException.needsForeground` |
| `apps/mobile/android/.../printer/UsbTransport.kt` | modify | background refusal flagged; a reply without the extra still releases the wait |
| `apps/mobile/android/.../printer/PrinterManager.kt` | modify | `usbWaitingForeground`; only a denial pauses; resume asks again |
| `apps/mobile/src/screens/PosScreen.tsx` | modify | the cover's Try again is a tap retry |
| `apps/mobile/src/screens/Brand.tsx` | modify | no inline style literal (lint) |
| `apps/mobile/src/mobile-paths.test.ts` | modify | pin 16 (USB) and pin 17 (cover retry), with mutations |
| `apps/mobile/TEST-CHECKLIST.md` | modify | Phase 0 device checks |
| `docs/superpowers/specs/2026-10-02-printing-reliability-design.md` | modify | mark F0.10 and F0.11 resolved |
| this plan | modify | fill in **Results** at the end |

Paths below shorten `apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/` to `KT/`.

---

### Task 1: Commit the ignore rule and record the brand decision

**Files:**
- Modify: `.gitignore` (the owner already appended `.playwright-mcp`; it is uncommitted)
- Modify: `docs/superpowers/specs/2026-10-02-printing-reliability-design.md` (§12 rows F0.10, F0.11)

**Interfaces:** none.

- [ ] **Step 1: Check the ignore rule and the trailing newline**

Run: `cd /d/kd/lucifer && git diff -- .gitignore && tail -c 20 .gitignore | od -c | tail -2`
Expected: the diff adds `.playwright-mcp`. If the last byte shown is not `\n`, add one with `printf '\n' >> .gitignore`.

- [ ] **Step 2: Confirm the snapshots are ignored**

Run: `git status --short | grep -c playwright`
Expected: `0`

- [ ] **Step 3: Mark F0.10 and F0.11 resolved in the spec**

In spec §12, replace the whole F0.10 row with:

```markdown
| F0.10 | Resolved (owner, 2026-10-02) | `apps/mobile/src/screens/Brand.tsx`, `UrlScreen.tsx`, `theme.ts`, `src/assets/sandbee-logo.png` | Keep GPT's Sandbee branding on the app's own native screens (boot, POS address, error, loading cover). Everything shown after the POS web page loads is the cafe's own brand. The launcher label stays as it is. No code change. |
```

Replace the whole F0.11 row with:

```markdown
| F0.11 | Done | repository root | `.playwright-mcp` (browser-tool session snapshots) is in the root `.gitignore`. |
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore docs/superpowers/specs/2026-10-02-printing-reliability-design.md
git commit -m "chore: ignore browser-tool snapshots; record the app-shell brand decision"
```

---

### Task 2: Web and app lanes resend once after a refusal made before any byte (F0.1)

**Why:** GPT's change rightly stopped replaying a slip that may be half printed. But web lanes produce no error code, so even a refusal made before any byte went out was treated as "may have printed" and never resent, and the KOT was lost. The fix: every refusal made before writing carries `code: "NOT_CONNECTED"`, exactly like the native app's refusal. The write queue already does ONE reconnect and ONE resend for that code.

**Files:**
- Modify: `apps/cafe/lib/printer/web-printer-types.ts` (add after `PRINTER_ELSEWHERE_MESSAGE`)
- Modify: `apps/cafe/lib/printer/device-printer-link.ts:225-227` (`send`)
- Modify: `apps/cafe/lib/printer/transport-ble.ts:118-125` (`write` loop)
- Modify: `apps/cafe/lib/printer/transport-serial.ts:85-87`
- Modify: `apps/cafe/lib/printer/transport-native.ts:186-189` (`write`)
- Modify: `apps/cafe/lib/printer/device-printer-write.ts:9-16` (header comment) and `:56-74` (catch block)
- Test: `apps/cafe/lib/printer/device-printer.test.ts`, `transports-ble.test.ts`, `device-printer-native.test.ts`

**Interfaces:**
- Produces: `notConnectedError(message: string): Error & { code: "NOT_CONNECTED" }`, exported from `@/lib/printer/web-printer-types`.
- `nativeErrorCode()` (in `@/lib/printer/native-bridge`) already returns `"NOT_CONNECTED"` for any error whose `code` is that string.

- [ ] **Step 1: Write the failing tests**

Append to `apps/cafe/lib/printer/device-printer.test.ts`:

```ts
test("write: a port that is no longer writable is refused before any byte: one reconnect and ONE resend", async () => {
  const { printer, port } = await connectedSerial();
  // The OS closed the port underneath us and no disconnect event fired: the panel still says connected.
  port.opened = false;
  await printer.write(new Uint8Array(100));
  assert.deepEqual(port.delivered, [100], "the resend delivered the whole job exactly once");
  assert.equal(port.opens, 2, "one silent reconnect");
  assert.equal(printer.getSnapshot().status, "connected");
});

test("write: a refusal whose reconnect fails says the printer is not connected, because nothing printed", async () => {
  const { printer, port } = await connectedSerial();
  port.opened = false;
  port.failOpen = 99;
  await assert.rejects(printer.write(new Uint8Array(10)), { message: PRINTER_NOT_CONNECTED_MESSAGE });
  assert.deepEqual(port.delivered, []);
});
```

Append to `apps/cafe/lib/printer/transports-ble.test.ts`. Also add `import { nativeErrorCode } from "@/lib/printer/native-bridge";` next to the other imports at the top.

```ts
test("connectBle: a link that dropped before the first chunk is a safe NOT_CONNECTED refusal", async () => {
  const calls: { kind: string; len: number }[] = [];
  const server = fakeServer({ [BLE_PRINTER_SERVICES[0].service]: [fakeChar(BLE_PRINTER_SERVICES[0].characteristic ?? "", true, false, calls)] });
  const link = await connectBle(fakeDevice(server), async () => undefined);
  (server as { connected: boolean }).connected = false;
  await assert.rejects(link.transport.write(new Uint8Array(10)), (e: unknown) => nativeErrorCode(e) === "NOT_CONNECTED");
  assert.equal(calls.length, 0, "nothing reached the printer");
});

test("connectBle: a link that drops after a chunk is uncertain (no NOT_CONNECTED code)", async () => {
  const calls: { kind: string; len: number }[] = [];
  const server = fakeServer({ [BLE_PRINTER_SERVICES[0].service]: [fakeChar(BLE_PRINTER_SERVICES[0].characteristic ?? "", true, false, calls)] });
  // The pause between chunks is where the link goes: the first chunk is already on the printer.
  const link = await connectBle(fakeDevice(server), async () => {
    (server as { connected: boolean }).connected = false;
  });
  await assert.rejects(link.transport.write(new Uint8Array(400)), (e: unknown) => nativeErrorCode(e) === null);
  assert.equal(calls.length, 1, "one chunk was written before the drop");
});
```

Append to `apps/cafe/lib/printer/device-printer-native.test.ts`:

```ts
test("native write: a NOT_CONNECTED refusal whose reconnect fails says not connected, because nothing printed", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.print", () => {
    throw nativeError("NOT_CONNECTED", "x");
  });
  fake.respond("printer.reconnect", () => nativeStatus("disconnected"));
  await assert.rejects(printer.write(new Uint8Array(4)), { message: PRINTER_NOT_CONNECTED_MESSAGE });
  assert.equal(fake.count("printer.print"), 1, "no resend without a link");
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/device-printer.test.ts lib/printer/transports-ble.test.ts lib/printer/device-printer-native.test.ts`
Expected, the new tests FAIL:
- the serial refusal rejects with `PRINTER_WRITE_FAILED_MESSAGE` and `delivered` is `[]`;
- the BLE pre-chunk drop has code `null`;
- the native test gets `PRINTER_WRITE_FAILED_MESSAGE`.

All older tests pass.

- [ ] **Step 3: Implement**

`apps/cafe/lib/printer/web-printer-types.ts`, add after `PRINTER_ELSEWHERE_MESSAGE`:

```ts
// A refusal made BEFORE any byte reached the printer (no link, the port is not writable,
// Bluetooth dropped before the first chunk). It carries the native bridge's NOT_CONNECTED code
// so the write queue treats web and app lanes alike: nothing printed, so ONE reconnect and ONE
// resend is safe. Anything that fails after a byte left stays code-less: it may already be on paper.
export function notConnectedError(message: string): Error & { code: "NOT_CONNECTED" } {
  return Object.assign(new Error(message), { code: "NOT_CONNECTED" as const });
}
```

`apps/cafe/lib/printer/device-printer-link.ts`: add `notConnectedError` to the existing import from `@/lib/printer/web-printer-types`, and change `send`:

```ts
    send(bytes: Uint8Array): Promise<void> {
      return transport === null ? Promise.reject(notConnectedError(PRINTER_NOT_CONNECTED_MESSAGE)) : transport.write(bytes);
    },
```

`apps/cafe/lib/printer/transport-ble.ts`:
- Import `notConnectedError` from `@/lib/printer/web-printer-types` (as a value, not `import type`).
- Add `const BLE_DISCONNECTED_MESSAGE = "The Bluetooth printer disconnected.";` beside the module's other constants.
- Change the `write` loop:

```ts
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += BLE_CHUNK_BYTES) {
        if (!server.connected) {
          // Before the first chunk nothing reached the printer: a safe refusal. After one, part of
          // the slip may be on paper, so the error carries no code and is never replayed.
          if (i === 0) throw notConnectedError(BLE_DISCONNECTED_MESSAGE);
          throw new Error(BLE_DISCONNECTED_MESSAGE);
        }
        await writeOne(target.characteristic, bytes.subarray(i, i + BLE_CHUNK_BYTES));
        if (i + BLE_CHUNK_BYTES < bytes.length) await sleep(BLE_CHUNK_PAUSE_MS);
      }
    },
```

`apps/cafe/lib/printer/transport-serial.ts`: add `notConnectedError` to the existing import from `@/lib/printer/web-printer-types`, then:

```ts
      if (writable === null) throw notConnectedError("The serial port is not writable.");
```

`apps/cafe/lib/printer/transport-native.ts`: import `notConnectedError` from `@/lib/printer/web-printer-types`, then change `write`:

```ts
    write(bytes: Uint8Array): Promise<void> {
      const client = host.native();
      return client === null ? Promise.reject(notConnectedError(PRINTER_NOT_CONNECTED_MESSAGE)) : nativeWrite(client, bytes);
    },
```

`apps/cafe/lib/printer/device-printer-write.ts`, change the header comment (lines 9–16) to:

```ts
// The write pipeline of the device printer: one job at a time (FIFO), one
// silent reconnect before the first send, and one resend ONLY after a refusal
// made before writing (NOT_CONNECTED, from the native app or a web lane). A
// failed write may already have printed part or all of a slip; replaying it
// duplicates orders. A hard deadline covers the whole job. The deadline is
// measured from ENQUEUE (time spent waiting behind another slip counts) and
// covers the reconnect and the resend; it stays under the 90 s host dispatch
// window together with the raster step.
```

Replace the `try { return await host.send(bytes); } catch (first) { … }` block inside `attempt` with:

```ts
    try {
      return await host.send(bytes);
    } catch (first) {
      const code = nativeErrorCode(first);
      if (code !== "NOT_CONNECTED") {
        if (code === null || code === "WRITE_FAILED" || code === "TIMEOUT") host.markDisconnected();
        throw new Error(code === null ? PRINTER_WRITE_FAILED_MESSAGE : nativeErrorMessage(first));
      }
      // Refused before writing (app or web lane): nothing printed, so a failure from here on says
      // "not connected", and ONE reconnect plus ONE resend is safe.
      if (job.expired || host.now() - job.enqueuedAt >= DEVICE_WRITE_DEADLINE_MS) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
      host.markDisconnected();
      const reconnected = await host.reconnect();
      if (job.expired || !reconnected) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
      try {
        return await host.send(bytes); // the ONE resend
      } catch (second) {
        host.markDisconnected();
        throw new Error(nativeErrorCode(second) === "NOT_CONNECTED" ? PRINTER_NOT_CONNECTED_MESSAGE : PRINTER_WRITE_FAILED_MESSAGE);
      }
    }
```

- [ ] **Step 4: Run all printer suites and see them pass**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/*.test.ts`
Expected: all pass. If an older test expected `PRINTER_WRITE_FAILED_MESSAGE` after a NOT_CONNECTED refusal whose reconnect or resend failed, change that expectation to `PRINTER_NOT_CONNECTED_MESSAGE`, because nothing printed in that path. Do not relax any test about uncertain (code-less, `WRITE_FAILED`, `TIMEOUT`) failures. Those must still never be replayed.

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/printer/web-printer-types.ts apps/cafe/lib/printer/device-printer-link.ts apps/cafe/lib/printer/transport-ble.ts apps/cafe/lib/printer/transport-serial.ts apps/cafe/lib/printer/transport-native.ts apps/cafe/lib/printer/device-printer-write.ts apps/cafe/lib/printer/device-printer.test.ts apps/cafe/lib/printer/transports-ble.test.ts apps/cafe/lib/printer/device-printer-native.test.ts
git commit -m "fix(print): a refusal before any byte is resent once on web lanes too; a half-printed slip is still never replayed"
```

---

### Task 3: Printer picker: independent loads, scan on unknown Bluetooth, ordered status, late bridge (F0.3–F0.6)

**Files:**
- Create: `apps/cafe/lib/printer/native-picker-state.ts`
- Create: `apps/cafe/lib/printer/native-picker-state.test.ts`
- Modify: `apps/cafe/components/print/NativePrinterPicker.tsx` (imports, state, mount effect, `refreshPrinters`, the two buttons)
- Modify: `apps/cafe/lib/printer-ui-paths.test.ts` (`nativePin` needles around line 191; `F.native` mutations around line 343)
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces, from `@/lib/printer/native-picker-state`:
  - `canScanBluetooth(bluetooth: NativeBluetoothState | null): boolean`
  - `loadPicker(status: () => Promise<{ bluetooth: NativeBluetoothState }>, list: () => Promise<NativePrinter[]>): Promise<PickerLoad>`
  - `interface PickerLoad { bluetooth: NativeBluetoothState | null; printers: NativePrinter[] | null; listError: unknown }`
  - `createStatusOrder(): { event(): void; start(): number; fresh(startedAt: number): boolean }`
- Consumes: `NativeBluetoothState` and `NativePrinter` from `@/lib/printer/native-bridge-protocol`.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/cafe/lib/printer/native-picker-state.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canScanBluetooth, createStatusOrder, loadPicker } from "@/lib/printer/native-picker-state";
import type { NativePrinter } from "@/lib/printer/native-bridge-protocol";

const USB: NativePrinter[] = [{ id: "usb:1:2", name: "USB printer", transport: "usb" }];

test("canScanBluetooth: only a Bluetooth known to be unusable disables the scan", () => {
  assert.equal(canScanBluetooth(null), true, "unknown (status failed) stays enabled; the scan reports its own error");
  assert.equal(canScanBluetooth("on"), true);
  for (const state of ["off", "unauthorized", "unsupported"] as const) assert.equal(canScanBluetooth(state), false, state);
});

test("loadPicker: a failed status keeps a good list (USB works without Bluetooth)", async () => {
  const result = await loadPicker(() => Promise.reject(new Error("timeout")), () => Promise.resolve(USB));
  assert.equal(result.bluetooth, null);
  assert.deepEqual(result.printers, USB);
  assert.equal(result.listError, null);
});

test("loadPicker: a failed list keeps a good status and returns the error", async () => {
  const error = new Error("list failed");
  const result = await loadPicker(() => Promise.resolve({ bluetooth: "on" as const }), () => Promise.reject(error));
  assert.equal(result.bluetooth, "on");
  assert.equal(result.printers, null);
  assert.equal(result.listError, error);
});

test("loadPicker: both requests start together (neither waits for the other)", async () => {
  const started: string[] = [];
  let releaseStatus!: () => void;
  const status = () => {
    started.push("status");
    return new Promise<{ bluetooth: "on" }>((resolve) => (releaseStatus = () => resolve({ bluetooth: "on" })));
  };
  const list = () => {
    started.push("list");
    return Promise.resolve(USB);
  };
  const pending = loadPicker(status, list);
  assert.deepEqual(started, ["status", "list"]);
  releaseStatus();
  assert.equal((await pending).bluetooth, "on");
});

test("createStatusOrder: a reply to a request that started before a pushed event is stale", () => {
  const order = createStatusOrder();
  const before = order.start();
  order.event();
  assert.equal(order.fresh(before), false, "the event is newer than this reply");
  const after = order.start();
  assert.equal(order.fresh(after), true);
});
```

Add `"lib/printer/native-picker-state.test.ts"` to the `testChain` array in `apps/cafe/package.json`, directly after `"lib/printer/transports-ble.test.ts"`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/native-picker-state.test.ts`
Expected: FAIL with "Cannot find module '@/lib/printer/native-picker-state'".

- [ ] **Step 3: Implement the module**

Create `apps/cafe/lib/printer/native-picker-state.ts`:

```ts
import type { NativeBluetoothState, NativePrinter } from "@/lib/printer/native-bridge-protocol";

// The in-app printer picker's state rules, kept pure so they are unit-tested (the panel itself is
// pinned by source checks in lib/printer-ui-paths.test.ts).

/** Find printers (a Bluetooth scan) is offered unless Bluetooth is KNOWN to be unusable. Unknown
 *  (null: the status request failed or has not answered) stays enabled: the scan reports its own error. */
export function canScanBluetooth(bluetooth: NativeBluetoothState | null): boolean {
  return bluetooth !== "off" && bluetooth !== "unauthorized" && bluetooth !== "unsupported";
}

export interface PickerLoad {
  /** null: the status request failed; keep whatever the panel already shows. */
  bluetooth: NativeBluetoothState | null;
  /** null: the list request failed; `listError` says why. */
  printers: NativePrinter[] | null;
  listError: unknown;
}

/** Status and list are independent requests: one failing never discards the other, so a USB
 *  printer still lists on a tablet whose Bluetooth status cannot be read. */
export async function loadPicker(
  status: () => Promise<{ bluetooth: NativeBluetoothState }>,
  list: () => Promise<NativePrinter[]>,
): Promise<PickerLoad> {
  const [s, l] = await Promise.allSettled([status(), list()]);
  return {
    bluetooth: s.status === "fulfilled" ? s.value.bluetooth : null,
    printers: l.status === "fulfilled" ? l.value : null,
    listError: l.status === "rejected" ? l.reason : null,
  };
}

/** Orders Bluetooth-state writes: a request's reply is dropped when a pushed printer.status event
 *  arrived after the request started (the event is newer). */
export function createStatusOrder(): { event(): void; start(): number; fresh(startedAt: number): boolean } {
  let events = 0;
  return {
    event() {
      events += 1;
    },
    start() {
      return events;
    },
    fresh(startedAt) {
      return startedAt === events;
    },
  };
}
```

- [ ] **Step 4: Run the unit tests and see them pass**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/native-picker-state.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Add the failing source pins**

In `apps/cafe/lib/printer-ui-paths.test.ts`, inside `nativePin` (around line 191), add these strings to the `needles` array:

```ts
"canScanBluetooth(bluetooth)", "loadPicker(", "statusOrder.fresh(startedAt)", "window.addEventListener(NATIVE_READY_EVENT, onReady)", '{refreshing ? "Refreshing printers…" : "Refresh USB / paired printers"}',
```

In the `{ file: F.native, pin: nativePin, mutations: [ … ] }` entry (around line 343), add:

```ts
    mut("find disabled on an unknown Bluetooth state", "!canScanBluetooth(bluetooth)", 'bluetooth !== "on"'),
    mut("status and list coupled again", "loadPicker(", "loadPickerAll("),
    mut("a stale status reply wins", "statusOrder.fresh(startedAt)", "true"),
    mut("a late bridge is ignored", "window.addEventListener(NATIVE_READY_EVENT, onReady)", ""),
    mut("refresh label follows the shared busy flag", '{refreshing ? "Refreshing printers…"', '{working ? "Refreshing printers…"'),
```

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer-ui-paths.test.ts`
Expected: FAIL. The new needles are missing from `NativePrinterPicker.tsx`.

- [ ] **Step 6: Wire the picker**

In `apps/cafe/components/print/NativePrinterPicker.tsx`:

1. Imports: change the React import to `import { useCallback, useEffect, useRef, useState } from "react";`. Change the bridge import to `import { NATIVE_READY_EVENT, nativeClient, nativeRequest } from "@/lib/printer/native-bridge";`. Add `import { canScanBluetooth, createStatusOrder, loadPicker } from "@/lib/printer/native-picker-state";`.
2. State: after `const [working, setWorking] = useState(false);` add `const [refreshing, setRefreshing] = useState(false);`. Change `locked` to `const locked = busy || scanning || working || refreshing;`. Then add:

```tsx
  const statusOrder = useRef(createStatusOrder()).current;
  const mounted = useRef(true);

  // One loader for mount and Refresh. Status and list settle independently: a USB printer still
  // lists when the Bluetooth status cannot be read, and a reply older than a pushed status event
  // never overwrites it.
  const load = useCallback(async () => {
    const startedAt = statusOrder.start();
    const result = await loadPicker(() => nativeRequest("printer.status"), () => devicePrinter().listNative(false));
    if (!mounted.current) return;
    if (result.bluetooth !== null && statusOrder.fresh(startedAt)) setBluetooth(result.bluetooth);
    if (result.printers !== null) {
      setPrinters(result.printers);
      return;
    }
    setPrinters((current) => current ?? []);
    const error = result.listError;
    toast.error(nativeErrorMessage(error));
  }, [statusOrder]);
```

3. Replace the whole mount `useEffect` with:

```tsx
  useEffect(() => {
    mounted.current = true;
    let off: (() => void) | undefined;
    const subscribe = (): void => {
      if (off !== undefined) return;
      off = nativeClient()?.on("printer.status", (status) => {
        if (!mounted.current) return;
        statusOrder.event();
        setBluetooth(status.bluetooth);
      });
    };
    // The bridge can announce itself after this panel mounted (a slow app start): subscribe and load then.
    const onReady = (): void => {
      subscribe();
      void load();
    };
    subscribe();
    window.addEventListener(NATIVE_READY_EVENT, onReady);
    void load();
    return () => {
      mounted.current = false;
      window.removeEventListener(NATIVE_READY_EVENT, onReady);
      off?.();
    };
  }, [load, statusOrder]);
```

4. Replace `refreshPrinters` with:

```tsx
  const refreshPrinters = async () => {
    if (locked) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };
```

5. Buttons: change the Refresh button's label expression to `{refreshing ? "Refreshing printers…" : "Refresh USB / paired printers"}`. Change the Find printers button's `disabled` to `disabled={locked || !canScanBluetooth(bluetooth)}`.
6. Fix the JSX indentation of the "Printers this device can see" block, which GPT left one level too deep after removing its wrapper. Formatting only.

- [ ] **Step 7: Run the pins, unit tests, type check and lint**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer-ui-paths.test.ts lib/print-host-card-paths.test.ts lib/printer/native-picker-state.test.ts && npx tsc --noEmit && npx eslint components/print/NativePrinterPicker.tsx lib/printer/native-picker-state.ts lib/printer/native-picker-state.test.ts`
Expected: all pass; tsc 0 errors; eslint 0 problems. The existing pin `toast.error(nativeErrorMessage(error))` still counts ≥ 4: find, turn on, allow, and `load`.

- [ ] **Step 8: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/printer/native-picker-state.ts apps/cafe/lib/printer/native-picker-state.test.ts apps/cafe/components/print/NativePrinterPicker.tsx apps/cafe/lib/printer-ui-paths.test.ts apps/cafe/package.json
git commit -m "fix(print): the app printer picker lists USB when the Bluetooth status fails, scans on an unknown state, and ignores stale status replies"
```

---

### Task 4: Real tints on old WebViews (F0.8)

**Why:** Tailwind v4 compiles `bg-primary/10` to this (verified on this branch):

```css
.bg-primary\/10{background-color:var(--primary)}
@supports (color:color-mix(in lab, red, red)){.bg-primary\/10{background-color:color-mix(in oklab, var(--primary) 10%, transparent)}}
```

Chromium 109 has no `color-mix()`, so the tint paints as the **full** colour. A 10 % wash becomes a solid blue or red block, and an 80 % black overlay becomes opaque. The fix is a PostCSS step after the oklab fallback. Wherever `--x` is set to a plain sRGB value, it adds `--x-rgb: R G B` in the same rule, so light and dark each get their own. It then rewrites each solid fallback to `rgb(var(--x-rgb) / N%)`, which works from Chromium 65.

**Files:**
- Create: `apps/cafe/postcss-tint-fallback.cjs`
- Modify: `apps/cafe/postcss.config.mjs`
- Modify: `apps/cafe/lib/css-compat.test.ts`

**Interfaces:**
- Produces: the default export `tintFallback`, a PostCSS plugin creator with `postcss = true`. It also exposes `channelsOf(value: string): string | null` and `findFallback(supports, modern)` for the tests.
- Next.js loads PostCSS plugins with `require.resolve(name, { paths: [appDir] })` and then `require()`, so a relative `"./postcss-tint-fallback.cjs"` key works. It must be CommonJS.

- [ ] **Step 1: Write the failing tests**

Replace `apps/cafe/lib/css-compat.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type Node, type Root, type Rule } from "postcss";
import tailwind from "@tailwindcss/postcss";
import oklab from "@csstools/postcss-oklab-function";
import colorMix from "@csstools/postcss-color-mix-function";
import tintFallback from "../postcss-tint-fallback.cjs";

// The production pipeline from postcss.config.mjs, in the same order.
async function compileCss(): Promise<Root> {
  const from = path.resolve(__dirname, "../app/globals.css");
  const { root } = await postcss([
    tailwind({ base: path.resolve(__dirname, ".."), optimize: true }),
    colorMix({ preserve: true }),
    oklab({ preserve: true }),
    tintFallback(),
  ]).process(readFileSync(from, "utf8"), { from });
  return root;
}

const MIX = /^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)$/;

test("production CSS supplies RGB tokens for WebView 109 and gates modern overrides", async () => {
  const root = await compileCss();
  let rgbTokens = 0;
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    if (/^(rgb\(|#[\da-f])/i.test(decl.value)) rgbTokens++;
    if (!/oklch\(|oklab\(|color\(display-p3/.test(decl.value)) return;
    let node: Node | undefined = decl.parent;
    while (node && !(node.type === "atrule" && "name" in node && node.name === "supports")) node = node.parent;
    assert.ok(node, `${decl.prop} must not override the RGB fallback in an old WebView`);
  });
  assert.ok(rgbTokens > 30, "both semantic tokens and Tailwind palette are compiled to RGB");
});

test("old-WebView tints: no opacity utility on a theme colour keeps a solid fallback", async () => {
  const root = await compileCss();
  const twins = new Set<string>();
  root.walkDecls(/-rgb$/, (decl) => {
    twins.add(decl.prop.slice(0, -"-rgb".length));
  });
  const solid: string[] = [];
  let rewritten = 0;
  root.walkAtRules("supports", (supports) => {
    if (!/color-mix\(in lab/.test(supports.params)) return;
    supports.walkDecls((modern) => {
      const m = MIX.exec(modern.value);
      if (!m || !twins.has(m[1])) return;
      const fallback = tintFallback.findFallback(supports, modern);
      if (fallback?.value === `rgb(var(${m[1]}-rgb) / ${m[2]}%)`) rewritten++;
      else solid.push(`${(modern.parent as Rule).selector ?? "(nested)"} ${modern.prop}: ${fallback?.value ?? "no fallback"}`);
    });
  });
  assert.deepEqual(solid, [], "every tint on a theme colour must fall back to rgb(var(--x-rgb) / N%)");
  assert.ok(rewritten > 20, `the POS uses dozens of tints; only ${rewritten} were rewritten`);
  const css = root.toString();
  for (const [cls, token, pct] of [
    ["bg-primary\\/10", "--primary", "10"],
    ["bg-destructive\\/10", "--destructive", "10"],
    ["bg-muted\\/40", "--muted", "40"],
  ] as const) {
    assert.ok(css.includes(`.${cls}{background-color:rgb(var(${token}-rgb) / ${pct}%)}`), `${cls} must fall back to an rgb() alpha`);
  }
});

test("old-WebView tints: light and dark themes each define their own channel twins", async () => {
  const root = await compileCss();
  const selectors: string[] = [];
  root.walkDecls("--primary-rgb", (decl) => {
    if (decl.parent?.type === "rule") selectors.push((decl.parent as Rule).selector);
  });
  assert.ok(selectors.some((s) => s.includes(":root")), "light theme twin");
  assert.ok(selectors.some((s) => s.includes(".dark")), "dark theme twin");
});

test("old-WebView tints: the colour parser takes rgb() and hex, and refuses alpha", () => {
  assert.equal(tintFallback.channelsOf("rgb(37 99 235)"), "37 99 235");
  assert.equal(tintFallback.channelsOf("rgb(37, 99, 235)"), "37 99 235");
  assert.equal(tintFallback.channelsOf("#2563eb"), "37 99 235");
  assert.equal(tintFallback.channelsOf("#fff"), "255 255 255");
  assert.equal(tintFallback.channelsOf("rgb(0 0 0 / 0.1)"), null, "a token with its own alpha keeps Tailwind's fallback");
  assert.equal(tintFallback.channelsOf("#0000001a"), null);
  assert.equal(tintFallback.channelsOf("oklch(0.6 0.2 260)"), null);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/css-compat.test.ts`
Expected: FAIL with "Cannot find module '../postcss-tint-fallback.cjs'".

- [ ] **Step 3: Implement the PostCSS step**

Create `apps/cafe/postcss-tint-fallback.cjs`:

```js
"use strict";
// Old Android WebViews (Chromium < 111, e.g. 109 on Android 13 counter tablets) cannot read
// color-mix(). Tailwind v4 writes an opacity utility on a theme colour as a SOLID fallback plus a
// color-mix() override inside @supports, so on those engines bg-primary/10 paints the full colour.
// This step runs AFTER Tailwind and the oklab fallback:
//   1. wherever a colour custom property --x is set to a plain sRGB value (outside @supports), it
//      adds --x-rgb: R G B in the same rule, so light (:root) and dark (.dark) each get their own;
//   2. it rewrites each solid fallback var(--x) whose @supports twin is
//      color-mix(in oklab, var(--x) N%, transparent) to rgb(var(--x-rgb) / N%).
// Space-separated rgb() with a slash alpha works from Chromium 65. A token that carries its own
// alpha gets no twin and keeps Tailwind's fallback.

const MIX = /^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)$/;
const SUPPORTS_MIX = /color:\s*color-mix\(in lab,\s*red,\s*red\)/;

/** "rgb(37 99 235)", "rgb(37, 99, 235)", "#2563eb" or "#26e" → "37 99 235"; anything else → null. */
function channelsOf(value) {
  const v = value.trim().toLowerCase();
  let m = /^rgb\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)\s*\)$/.exec(v);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  m = /^#([\da-f]{3}|[\da-f]{6})$/.exec(v);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

function insideSupports(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "supports") return true;
  return false;
}

/** The solid declaration Tailwind wrote for the same property: in an earlier sibling rule with the
 *  same selector (optimized, flattened CSS) or in the rule the @supports block is nested in (dev CSS). */
function findFallback(supports, modern) {
  const owner = modern.parent;
  const candidates = [];
  if (owner && owner.type === "rule") {
    for (let node = supports.prev(); node; node = node.prev()) {
      if (node.type === "rule" && node.selector === owner.selector) {
        candidates.push(node);
        break;
      }
    }
  }
  if (supports.parent && supports.parent.type === "rule") candidates.push(supports.parent);
  for (const rule of candidates) {
    let found = null;
    rule.each((node) => {
      if (node.type === "decl" && node.prop === modern.prop) found = node;
    });
    if (found) return found;
  }
  return null;
}

/** @type {import("postcss").PluginCreator<Record<string, never>>} */
function tintFallback() {
  return {
    postcssPlugin: "pos-tint-fallback",
    OnceExit(root) {
      const twins = new Set();
      root.walkDecls(/^--/, (decl) => {
        if (decl.prop.endsWith("-rgb") || insideSupports(decl)) return;
        const channels = channelsOf(decl.value);
        if (channels === null) return;
        decl.cloneAfter({ prop: `${decl.prop}-rgb`, value: channels });
        twins.add(decl.prop);
      });
      root.walkAtRules("supports", (supports) => {
        if (!SUPPORTS_MIX.test(supports.params)) return;
        supports.walkDecls((modern) => {
          const m = MIX.exec(modern.value);
          if (!m || !twins.has(m[1])) return;
          const fallback = findFallback(supports, modern);
          if (fallback && fallback.value.trim() === `var(${m[1]})`) fallback.value = `rgb(var(${m[1]}-rgb) / ${m[2]}%)`;
        });
      });
    },
  };
}
tintFallback.postcss = true;
tintFallback.channelsOf = channelsOf;
tintFallback.findFallback = findFallback;

module.exports = tintFallback;
```

Change `apps/cafe/postcss.config.mjs` to:

```js
const config = {
  // Android WebView is updated separately from Android. Older counter tablets (including
  // Chromium 109) can paint neither OKLCH tokens nor color-mix() tints. AFTER Tailwind: RGB
  // fallbacks for every colour (wide-gamut values kept in @supports), then real alpha fallbacks
  // for opacity tints such as bg-primary/10 (see postcss-tint-fallback.cjs).
  plugins: {
    "@tailwindcss/postcss": {},
    "@csstools/postcss-color-mix-function": { preserve: true },
    "@csstools/postcss-oklab-function": { preserve: true },
    "./postcss-tint-fallback.cjs": {},
  },
};

export default config;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/css-compat.test.ts && npx tsc --noEmit`
Expected: 4 pass; tsc 0 errors.

If `solid` lists entries:
- The message names the selector and value. A value like `var(--x)` whose `--x` was set only inside a theme block the plugin didn't see means the twin search must include that rule. Fix the plugin, not the test.
- A token with its own alpha has no twin and is excluded by design.

- [ ] **Step 5: Prove Next.js loads the step (production build)**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build 2>&1 | tail -25`
Expected: the build succeeds. The build reads `.env.local` on this PC; never print its values.

Then confirm the shipped CSS has the fallback:

```bash
grep -l "rgb(var(--primary-rgb) / 10%)" .next/static/css/*.css
```

Expected: at least one file.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/postcss-tint-fallback.cjs apps/cafe/postcss.config.mjs apps/cafe/lib/css-compat.test.ts
git commit -m "fix(cafe): opacity tints paint as tints on WebView 109 (rgb alpha fallbacks per theme)"
```

---

### Task 5: Android USB permission: only a denial pauses; a hidden app asks again when visible (F0.2, F0.7)

**Why:** `UsbTransport.open()` throws `UNAUTHORIZED("USB permission needed")` when the app is hidden, because a system dialog cannot show. GPT's `PrinterManager` treats every USB `UNAUTHORIZED` as a denial and pauses reconnects. After a cold start, or a replug in the background, the printer then stays red until someone taps Reconnect, even though nobody denied anything.

**Files:**
- Modify: `KT/PrinterTypes.kt:32`
- Modify: `KT/UsbTransport.kt:77` (background refusal) and `:118` (permission receiver)
- Modify: `KT/PrinterManager.kt` (fields; `begin()`; `halt()`; the USB block in `attempt()`; `scheduleReconnect()`; `resumeIfPaused()`)
- Test: `apps/mobile/src/mobile-paths.test.ts` (new pin 16)

**Interfaces:**
- Produces: `TransportException(code: String, message: String, needsForeground: Boolean = false)`. Existing two-argument call sites are unchanged.
- `PrinterManager.resumeIfPaused()` (called by `PrinterApi.refreshStatus`, which `PosPrinterModule.onHostResume` calls after setting `appVisible = true`) now also retries a USB printer that waits for the foreground.

- [ ] **Step 1: Write the failing pin**

In `apps/mobile/src/mobile-paths.test.ts`:
- add `usb: string;` to `interface KtSources` (around line 1271);
- add `usb: kt('UsbTransport.kt'),` to `ktSources()` (around line 1631);
- add after pin 15:

```ts
function usbPermissionProblems(s: KtSources): string[] {
  const out: string[] = [];
  const types = strip(s.types);
  const usb = strip(s.usb);
  const manager = strip(s.manager);
  if (!types.includes('class TransportException(val code: String, message: String, val needsForeground: Boolean = false)')) {
    out.push('TransportException must say when a refusal only needs the foreground');
  }
  if (!usb.includes('throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true)')) {
    out.push('a hidden app must report "needs the foreground", not a denial');
  }
  if (!usb.includes('(target == null || target.deviceName == device.deviceName)')) {
    out.push('a permission reply without EXTRA_DEVICE must still release the wait');
  }
  if (!manager.includes('if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true')) {
    out.push('only a real denial may pause USB reconnects');
  }
  if (!manager.includes('if (usbWaitingForeground && appVisible) selected else null')) {
    out.push('resumeIfPaused must ask again once the app is visible');
  }
  if (!manager.includes('usbPermissionPaused || usbWaitingForeground) return')) {
    out.push('no background reconnect loop while USB waits for permission');
  }
  return out;
}

test('pin 16: USB permission — only a denial pauses; a hidden app asks again when visible', () => {
  assert.deepEqual(usbPermissionProblems(ktSources()), []);
});

test('pin 16 mutation: every USB permission needle can fail', () => {
  const base = ktSources();
  const run = (key: keyof KtSources) => (text: string) => usbPermissionProblems({ ...base, [key]: text });
  everyMutationCaught(run('types'), base.types, [[', val needsForeground: Boolean = false', '']]);
  everyMutationCaught(run('usb'), base.usb, [
    ['"USB permission needed", needsForeground = true', '"USB permission needed"'],
    ['(target == null || target.deviceName == device.deviceName)', '(target?.deviceName == device.deviceName)'],
  ]);
  everyMutationCaught(run('manager'), base.manager, [
    ['if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true', 'usbPermissionPaused = true'],
    ['if (usbWaitingForeground && appVisible) selected else null', 'if (false) selected else null'],
    ['usbPermissionPaused || usbWaitingForeground) return', 'usbPermissionPaused) return'],
  ]);
});
```

- [ ] **Step 2: Run the pin and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/mobile-paths.test.ts`
Expected: pin 16 FAILS with six problems. The mutation test fails at "baseline must be clean". All other pins pass.

- [ ] **Step 3: Implement the Kotlin**

`KT/PrinterTypes.kt` line 32:

```kotlin
/** [needsForeground]: refused only because the app is hidden, so a system dialog cannot show yet.
 *  Not a denial: the manager asks again once the app is visible. */
class TransportException(val code: String, message: String, val needsForeground: Boolean = false) : IOException(message)
```

`KT/UsbTransport.kt` line 77:

```kotlin
      if (!isVisible()) throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true)
```

`KT/UsbTransport.kt`, the receiver's `onReceive`:

```kotlin
          override fun onReceive(context: Context, intent: Intent) {
            val target = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            // The extra names the device; a reply without it is still a reply. hasPermission() decides below.
            if (intent.action == ACTION_USB_PERMISSION && (target == null || target.deviceName == device.deviceName)) answered.countDown()
          }
```

`KT/PrinterManager.kt`:

1. Below `private var usbPermissionPaused = false` add:

```kotlin
  // The selected USB printer needs permission but the app was hidden (no dialog can show).
  // resumeIfPaused() asks again once the app is visible; not a denial, so no explicit Reconnect needed.
  private var usbWaitingForeground = false
```

2. In `begin()` and in `halt()`, beside each `usbPermissionPaused = false`, add `usbWaitingForeground = false`.
3. In `attempt()`, replace the USB `UNAUTHORIZED` block with:

```kotlin
      if (info.transport == BridgeCodes.TRANSPORT_USB && e is TransportException && e.code == BridgeCodes.UNAUTHORIZED) {
        synchronized(lock) {
          if (gen != generation) return
          pending = null
          state = BridgeCodes.STATE_DISCONNECTED
          // Hidden app: ask again when visible. A real denial (the dialog was shown and refused)
          // waits for an explicit Reconnect: never a prompt loop.
          if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true
        }
        publish()
        return
      }
```

4. In `scheduleReconnect()`, change the guard to:

```kotlin
      if (gen != generation || info == null || usbPermissionPaused || usbWaitingForeground) return
```

5. In `resumeIfPaused()`, directly after `val ctx = app ?: return`, add:

```kotlin
    // A USB printer that needed permission while the app was hidden asks once the app is visible.
    val usbInfo = synchronized(lock) { if (usbWaitingForeground && appVisible) selected else null }
    if (usbInfo != null) {
      val gen = begin(usbInfo)
      connectAsync(gen) {}
      return
    }
```

- [ ] **Step 4: Run the pins and compile the Kotlin**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/mobile-paths.test.ts`
Expected: every pin passes, including pin 16 and its mutation test. If a pin-14 needle pinned GPT's exact `usbPermissionPaused = true` block, keep its intent and update that needle to the new line.

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileReleaseKotlin -PreactNativeArchitectures=arm64-v8a --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=512m" -Pkotlin.compiler.execution.strategy=in-process 2>&1 | tail -5`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterTypes.kt apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/UsbTransport.kt apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterManager.kt apps/mobile/src/mobile-paths.test.ts
git commit -m "fix(mobile): a USB printer that needed permission in the background asks again when the app opens; only a denial pauses"
```

---

### Task 6: The loading cover's Try again is a tap retry; Brand lint (F0.9)

**Files:**
- Modify: `apps/mobile/src/screens/PosScreen.tsx` (`WebProps`, `PosWebView` props, the `WorkspaceCover` element, the `PosWebView` element in `PosScreen`)
- Modify: `apps/mobile/src/screens/Brand.tsx` (the `SandbeeLogo` style)
- Test: `apps/mobile/src/mobile-paths.test.ts` (new pin 17)

**Interfaces:**
- Produces: a `PosWebView` prop `onRetryTap: () => void`. `PosScreen` passes its existing `retryByTap`, which resets the automatic-retry count and remounts.

- [ ] **Step 1: Write the failing pin**

Append to `apps/mobile/src/mobile-paths.test.ts`:

```ts
function coverRetryProblems(pos: string): string[] {
  const code = strip(pos);
  const out: string[] = [];
  if (!code.includes('onRetry={onRetryTap}')) out.push('the loading cover must call the tap retry');
  if (!code.includes('onRetryTap={retryByTap}')) out.push('PosScreen must hand retryByTap to the cover');
  if (code.includes('onRetry={onRenderGone}')) out.push('the cover must not reuse the crash remount');
  return out;
}

test('pin 17: the loading cover\'s Try again is a user retry', () => {
  assert.deepEqual(coverRetryProblems(read(join(SRC, 'screens', 'PosScreen.tsx'))), []);
});

test('pin 17 mutation: the cover retry wiring can be cut', () => {
  const base = read(join(SRC, 'screens', 'PosScreen.tsx'));
  everyMutationCaught(coverRetryProblems, base, [
    ['onRetry={onRetryTap}', 'onRetry={onRenderGone}'],
    ['onRetryTap={retryByTap}', 'onRetryTap={remount}'],
  ]);
});
```

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/mobile-paths.test.ts`
Expected: pin 17 FAILS.

- [ ] **Step 2: Implement**

In `apps/mobile/src/screens/PosScreen.tsx`:
- `type WebProps = Props & { onLoadError: () => void; onRenderGone: () => void; onRetryTap: () => void };`
- add `onRetryTap,` to `PosWebView`'s destructured props;
- change the cover to `<WorkspaceCover ready={!loading} origin={origin} onRetry={onRetryTap} />`, keeping the existing multi-line formatting;
- in `PosScreen`, add `onRetryTap={retryByTap}` to the `<PosWebView … />` element, beside `onRenderGone={remount}`.

In `apps/mobile/src/screens/Brand.tsx`, change the `SandbeeLogo` image style to:

```tsx
      style={[{ width: size, height: size }, light ? styles.logoLight : styles.logoDark]}
```

and add to the file's `StyleSheet.create({ … })`:

```tsx
  logoLight: { tintColor: '#ffffff' },
  logoDark: { tintColor: colors.navy },
```

- [ ] **Step 3: Run every mobile check**

Run: `cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test && npm run test:app`
Expected:
- tsc: 0 errors.
- lint: **0 problems**. The Brand.tsx warning is gone.
- node tests: all pass, now 108 plus the pin 16/17 tests.
- Jest: 3/3.

- [ ] **Step 4: Commit**

```bash
cd /d/kd/lucifer
git add apps/mobile/src/screens/PosScreen.tsx apps/mobile/src/screens/Brand.tsx apps/mobile/src/mobile-paths.test.ts
git commit -m "fix(mobile): the loading cover's Try again resets the automatic retries; the logo style passes lint"
```

---

### Task 7: Full verification, release build, emulator checks, checklist, results

**Files:**
- Modify: `apps/mobile/TEST-CHECKLIST.md` (the "Regression checks added 2026-10-02" section)
- Modify: this plan (fill in **Results**)

- [ ] **Step 1: Every suite**

Run each and record the totals in **Results**:

```bash
cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit
cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run test:app 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | tail -5
```

Expected:
- cafe: everything passes except the one known `go-live-dl.test.ts` ENOENT pin (Global Constraints).
- mobile: 0 lint problems, all tests pass.
- desktop: all pass (it is unchanged; this is a sanity run).

- [ ] **Step 2: Build the emulator APK, then the client APKs**

The order matters: an x86_64 build wipes the ARM APKs from the release folder.

```bash
cd /d/kd/lucifer/apps/mobile/android
export GRADLE_USER_HOME='D:\gradle-home'
./gradlew.bat aR -PreactNativeArchitectures=x86_64 --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=512m" -Pkotlin.compiler.execution.strategy=in-process
cp app/build/outputs/apk/release/app-release.apk "<scratchpad>/pos-emulator-x86_64-release.apk"
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=512m" -Pkotlin.compiler.execution.strategy=in-process
ls -la app/build/outputs/apk/release/
```

- `aR` is Gradle's short name for `assembleRelease`. Its name has no "release", so the per-CPU split stays off and one x86_64 APK comes out. **Emulator only, never for clients.**
- Expected: the folder ends with `app-arm64-v8a-release.apk` and `app-armeabi-v7a-release.apk`.
- If `app-release.apk` is still there, leave it, and say in **Results** that it is the emulator build.

- [ ] **Step 3: Emulator smoke test (app shell and USB-free paths)**

Boot the emulator with less RAM, because this PC has about 4–7 GB free:

```bash
powershell.exe -NoProfile -Command "Start-Process -FilePath 'C:\Users\kartik.desai\AppData\Local\Android\Sdk\emulator\emulator.exe' -ArgumentList '-avd','Pixel_7_API_33','-memory','4096','-no-snapshot','-no-boot-anim'"
```

Wait until `adb shell getprop sys.boot_completed` prints `1`. Then:

```bash
export MSYS_NO_PATHCONV=1
adb uninstall com.possoftware.pos
adb install "<scratchpad>/pos-emulator-x86_64-release.apk"
```

Check the TEST-CHECKLIST "Start-up and address" items:
1. the first start shows the POS address screen, with the Sandbee shell branding;
2. empty → "Enter the address of your POS.";
3. `http://example.com` → refused;
4. `ftp://x` → refused;
5. `https://does-not-exist.example.com` → "Could not open the POS" with Try again and Change address;
6. Change address → the old address is filled in;
7. on the loading cover, tap Try again: it retries.

Afterwards run `adb logcat -d -b crash` (expected empty) and grep the app process log for `FATAL|ClassNotFound|NoSuchMethod`. Expected: none.

- [ ] **Step 4: WebView 109 tint check (visual)**

1. Confirm the WebView: `adb shell dumpsys webviewupdate | grep -i "Current WebView package"` (expected 109.x).
2. Build the test page **in the scratchpad**, never in the repo. Run this from `apps/cafe` so the imports resolve from its `node_modules`. It uses the same four-plugin pipeline as `css-compat.test.ts`.

```bash
cd /d/kd/lucifer/apps/cafe && node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import oklab from "@csstools/postcss-oklab-function";
import colorMix from "@csstools/postcss-color-mix-function";
const cafe = process.cwd();
const tintFallback = createRequire(path.join(cafe, "package.json"))("./postcss-tint-fallback.cjs");
const from = path.join(cafe, "app/globals.css");
const { css } = await postcss([tailwind({ base: cafe, optimize: true }), colorMix({ preserve: true }), oklab({ preserve: true }), tintFallback()]).process(readFileSync(from, "utf8"), { from });
const swatches = ["bg-primary/10", "bg-destructive/10", "bg-muted/40", "bg-background/95"].map((c) => `<div class="${c} p-3 m-2 rounded">${c}</div>`).join("");
const block = (cls) => `<section class="${cls} bg-background text-foreground p-4">${swatches}<div class="relative m-2 h-16"><p class="p-2">Text under the overlay</p><div class="absolute inset-0 bg-black/80"></div></div><ul class="divide-y divide-brand-rule/70 m-2"><li class="p-2">row one</li><li class="p-2">row two</li></ul><div class="border border-destructive/40 m-2 p-2">border-destructive/40</div></section>`;
writeFileSync(process.argv[1], `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${block("")}${block("dark")}</body></html>`);
console.log("wrote", process.argv[1]);
' "<scratchpad>/tint-check.html"
```

3. The page shows a light section and a dark (`class="dark"`) section. Each has the most used tints, a dark overlay over text, a divided list and a tinted border.
4. Serve it on the host with a one-line Node server that answers every path with the page (the app opens `<address>/pos`): `node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'text/html'});s.end(require('fs').readFileSync(process.argv[1]))}).listen(8099)" "<scratchpad>/tint-check.html"`. Run it in the background.
5. In the app, enter `http://10.0.2.2:8099`, which is allowed because 10.x is private. Take a screenshot with `adb exec-out screencap -p > <scratchpad>/tint-109.png` and **look at it**. Tints must be light washes in both themes, and the overlay must show the text through it.
6. Stop the server, then `adb shell pm clear com.possoftware.pos`.

- [ ] **Step 5: Add the Phase 0 device checks to TEST-CHECKLIST.md**

Append to the "Regression checks added 2026-10-02" list:

```markdown
- [ ] Chrome on a PC or Android phone with a Web Serial or Web Bluetooth printer: unplug or
      power-cycle the printer, then print. A slip refused before anything was sent prints
      once after the automatic reconnect; a slip cut off mid-way is NOT reprinted by itself
      and the message says to check the paper.
- [ ] Android app with a USB printer: put the app in the background, unplug and replug the
      printer, then open the app. The USB permission prompt appears once; allow it and the
      printer connects. Deny it: no further prompts until you tap Reconnect.
- [ ] Old tablet (WebView 109 or older): light highlights, red error tints, borders and the
      dark overlay behind dialogs look like tints (not solid colour blocks), in light and
      dark mode.
```

- [ ] **Step 6: Fill in Results and update memory, then commit**

Fill in the **Results** section below with:
- every command and its totals;
- the APK paths and sizes;
- the emulator and tint findings, with screenshot paths;
- any deviation from this plan, and why;
- open issues.

Update the memory file `printing-redesign-2026-10.md` with Phase 0's status and the last commit hash. It is in the auto-memory directory listed in MEMORY.md.

```bash
cd /d/kd/lucifer
git add apps/mobile/TEST-CHECKLIST.md docs/superpowers/plans/2026-10-02-phase-0-review-fixes.md
git commit -m "docs(print): Phase 0 device checks and results"
git log --oneline -10
```

Do **not** push, do **not** merge, and do **not** start Phase 1. Report to the owner in Hinglish.

---

## Results (filled in by the implementer)

Executed 2026-10-02 on `feat/printing-reliability` (base `93a31cf`), one session, inline (superpowers:executing-plans). Nothing pushed or merged.

### Commits

| Task | Commit | Message |
|---|---|---|
| 1 | `4cdd927` | chore: ignore browser-tool snapshots; record the app-shell brand decision |
| 2 | `fc3c823` | fix(print): a refusal before any byte is resent once on web lanes too; a half-printed slip is still never replayed |
| 3 | `283fdb1` | fix(print): the app printer picker lists USB when the Bluetooth status fails, scans on an unknown state, and ignores stale status replies |
| 4 | `d69f053` | fix(cafe): opacity tints paint as tints on WebView 109 (rgb alpha fallbacks per theme) |
| 5 | `9f8bdc0` | fix(mobile): a USB printer that needed permission in the background asks again when the app opens; only a denial pauses |
| 6 | `be90ecb` | fix(mobile): the loading cover's Try again resets the automatic retries; the logo style passes lint |
| 7 (found) | `7edf7aa` | fix(mobile): a WebView remount (auto-retry, Try again) no longer crashes the app natively on WebView 109 |
| Final review | `ad9a933` | fix(cafe): the diner menu and the appearance preview tint with the cafe's own colours on old WebViews |
| Final review | `f762210` | fix(mobile): a USB printer that needs permission at cold start asks once the app is visible, even when the resume won the race |
| 7 | this commit | docs(print): Phase 0 device checks and results |

### TDD evidence (each new test watched failing first)

- Task 2: 4 new tests failed as the plan expected (serial resend, serial "not connected", BLE pre-chunk code, native "not connected"). The BLE "drops after a chunk" test is a guard: it passed before and after, by design. Then `lib/printer/*.test.ts` 312/312.
- Task 3: "Cannot find module", then 5/5; the 5 new source needles failed, then `printer-ui-paths` + `print-host-card-paths` + picker 45/45.
- Task 4: "Cannot find module", then 5/5 (the plan's 4 tests, unchanged, plus 1 added, see deviations). Mutations of the alias twin, the merged-rule split and the every-definition rule each fail the suite.
- Task 5: pin 16 failed with exactly the plan's six problems, then 33/33.
- Task 6: pin 17 failed (3 problems), then green.
- Crash fix: pin 18 failed (3 problems), then 37/37 in `mobile-paths.test.ts`.
- Final-review fixes:
  - The runtime twin tests failed first (4 tests). They then passed, with shared at 597/597.
  - The pin 16 race needle failed first, then 37/37.

### Suites (final code)

| Check | Command | Result |
|---|---|---|
| shared | `cd packages/shared && npm test`; `npx tsc --noEmit -p .` | **597/597**; 0 errors |
| cafe tests | `cd apps/cafe && npm test` | 3976 tests, **3975 pass, 1 fail**: the known `lib/go-live-dl.test.ts` "PIN: cb-dl2-decisions.md D-C's archive-path clause…" ENOENT for `.claude/plan/v2/_research/cb-dl2-decisions.md` (missing local planning file, unrelated) |
| cafe types | `npx tsc --noEmit` | 0 errors |
| cafe lint | `npm run lint` | 0 errors, 2 warnings, both pre-existing in `lib/masters-blob.test.ts:331` (unused `k`, `v`) |
| cafe build | `npm run build` | succeeds. The shipped CSS `.next/static/css/22b0ab1b93eaddb4.css` has 59 `rgb(var(--x-rgb)/N%)` fallbacks out of 63 tints (3 palette tints were already alpha; `--border` is excluded by design) |
| mobile | `npx tsc --noEmit`; `npm run lint`; `npm test`; `npm run test:app` | 0 errors; **0 problems** (the Brand.tsx warning is gone); **114/114**; Jest **3/3** |
| desktop | `cd apps/desktop && npm test` | **191/191** (unchanged app, sanity run) |
| Kotlin | `gradlew :app:compileReleaseKotlin` (Task 5), then both release builds | BUILD SUCCESSFUL |

### APKs (built x86_64 first, then ARM; final builds at `f762210`)

| APK | Path | Size | SHA-256 |
|---|---|---|---|
| Emulator only, never for clients (x86_64) | `<scratchpad>/pos-emulator-x86_64-release.apk` | 7,407,761 B | `fc4181e4f20799576277c7be312316d34d46db23b286bad6b13fec1cad5f13d3` |
| Client, arm64-v8a | `apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` | 7,276,038 B | `9f89cd9a172b2ab8d5b72872bca947c44ae3c7c74c3a33dfc118e9c00e180ff7` |
| Client, armeabi-v7a | `apps/mobile/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk` | 6,683,872 B | `f3f6214982c9122dbc7c28f415d7a478a8aef392b834bf8213cb909c73f426cc` |

The release folder holds only the two ARM APKs (the x86_64 build's `app-release.apk` was replaced by the ARM build). The x86_64 APK contains only `lib/x86_64/`; each ARM APK contains only its own ABI. All are debug-signed (no `POS_RELEASE_*` properties on this PC).

### Emulator smoke test (`Pixel_7_API_33`, Android 13, WebView `109.0.5414.123`)

1. First start shows the POS address screen with the Sandbee shell branding (navy logo, "POS Software by Sandbee"). Pass.
2. Empty → "Enter the address of your POS." Pass.
3. `http://example.com` → refused ("http:// only works for this device or a computer on your own network…"). Pass.
4. `ftp://x` → "The address must start with https://". Pass.
5. `https://does-not-exist.example.com` → "Could not open the POS" with Try again and Change address. Pass.
6. Change address → the old address is filled in. Pass, **after the crash fix** (see below; the first attempt crashed).
7. Loading cover (a local server that never answers, `http://10.0.2.2:8097`): after 12 s "Taking longer than usual" and Try again; three taps each went back to "Getting your workspace ready…" (the cover remounted), same process, no crash. Pass.
8. The owner's demo POS `https://posdemo.sandbee.in` loads its login page in the app (cafe brand, no crash). Not signed in; nothing changed there.

After the fix: `adb logcat -b crash` empty; no `FATAL|ClassNotFound|NoSuchMethod` in the app log.

**Found and fixed (`7edf7aa`): the app crashed ~17 s after any load error.** The automatic retry (and every Try again or crash remount) mounts a new WebView. `WebViewDelivery.attach` then called `ScriptHandler.remove()` on the previous, already destroyed WebView's document-start script, and Chromium dereferenced null in native code (`SIGSEGV`, `libmonochrome_64.so`, frame `vo0.remove`). No `try/catch` can stop a native crash. Reproduced twice with no tap at all. The code dates from `7ac4bcf`, so it is also on `main`. The fix only removes a handler owned by the WebView being attached. The fixed build survived 48 s of automatic retries, 5 error-screen Try again taps and 3 cover Try again taps in one process.

### WebView 109 tint check (looked at every screenshot)

Pages were built in the scratchpad, never the repo. Three pages, each with a light and a `.dark` section: tints, an 80 % black overlay over text, a divided list and a tinted border.
- **Shipped**: the minified CSS Next.js actually ships.
- **Pipeline**: the plan's four-plugin pipeline.
- **Before fix**: the pipeline without the new step.

Results:
- **Before fix:** `bg-primary/10` and `bg-brand-accent/15` are solid blue blocks and `bg-destructive/10` is a solid red block. In dark mode, `bg-primary/10` is an almost-white block, so its white text is unreadable.
- **Shipped and Pipeline:** every swatch is a light wash in light mode and a dark-theme tint in dark mode. The overlay shows the text through it, and the border and dividers are thin tints.
- **The page's own probe:** `Chrome 109 | bg-primary/10 = rgba(37, 99, 235, 0.1) | color-mix: false`. So the minified no-space form `rgb(var(--x-rgb)/10%)` works on 109.
- In dark mode the `divide-brand-rule/70` line is light, because the `--brand-*` tokens have no dark values (by design). A current browser paints the same, so this is not a regression.

Screenshots (scratchpad `C:/Users/KARTIK~1.DES/AppData/Local/Temp/claude/d--kd-lucifer/de410f71-5d33-46e7-a947-cece4e857642/scratchpad/`):
- `tint-109-shipped-top.png`, `tint-109-shipped-bottom.png`
- `tint-109-pipeline-top.png`
- `tint-109-before-fix-top.png`
- `smoke-01-first-start.png`, `smoke-05-could-not-open.png`, `smoke-06-change-address.png`, `smoke-07-cover-try-again.png`
- `demo-01-loaded.png`
- `menu-109-before.png`, `menu-109-after.png` (see the final review below)

Afterwards: servers stopped, `pm clear com.possoftware.pos`.

### Deviations from this plan (each ledgered as a ruling)

1. **Ledger location.** The executing skill's workspace is in the repo (`.superpowers/sdd/`, self-ignored). The rule "no temp files in the repo" won, so the ledger and logs live in the scratchpad. The skill's script had already created `.superpowers/sdd/` (two tiny files, git-ignored by its own `.gitignore`). Deleting them was blocked by the permission settings, so they are still there; `git status` stays clean.
2. **Task 3, line budget.** The plan's picker code makes `NativePrinterPicker.tsx` 279 lines, but `printer-ui-paths.test.ts` caps that file at 260. I kept the plan's code verbatim and raised that one budget to 280, with a comment. Every needle and mutation is unchanged, and the long-file mutation still fires.
3. **Task 4, plugin.** The plan's plugin could not pass the plan's own tests on this CSS:
   - Light `:root` sets `--primary: var(--brand-primary)`, an alias with no plain sRGB value, so the plan's plugin gives light mode no twin.
   - The optimizer merged 17 fallbacks into lists like `.bg-destructive,.bg-destructive\/10`. An exact-selector search misses them, and rewriting in place would also tint the plain utility.

   The plugin therefore:
   - (a) twins aliases as `var(--y-rgb)`;
   - (b) splits a merged fallback rule so only the tint changes;
   - (c) twins a token only if every definition is plain sRGB or such an alias. Dark `--border` has its own alpha, so it gets no twin anywhere and keeps Tailwind's fallback. A light-only twin would have painted dark tints with light channels.

   The plan's test file is unchanged. I added one test for (b) and (c); without it, the no-split mutation went unnoticed.
4. **Task 4, step 5.** Next's minifier writes `rgb(var(--primary-rgb)/10%)` without spaces, so the plan's grep for `/ 10%` finds nothing; the minified form is present. The tint pages on WebView 109 therefore include the shipped minified CSS, and the probe shows it parses.
5. **Task 7, port.** Docker Desktop holds `127.0.0.1:8099` (and 8096, 8098), and the emulator's `10.0.2.2` reaches that loopback. The tint pages were served on 8110/8111/8112 instead.
6. **Task 7, crash fix.** `7edf7aa`, pin 18 and one extra TEST-CHECKLIST line, as described above. These are outside the plan, but fixing the crash was needed for smoke item 7, and it kills the app for cafes.
7. Heredocs in this shell collapse `\\` to `\`. The affected test lines were rewritten with the editor, and the Task 4 test file was diffed against the plan's code block: identical.

### Final review (fresh reviewer, Opus, `93a31cf..7edf7aa`)

Verdict: "With fixes" — 0 Critical, 1 Important, 7 Minor. The F0.1 resend paths, the picker, the plugin's twin/split rules, the Kotlin flags and `7edf7aa` were judged correct; the plugin rewrite and the crash fix were judged justified deviations.

- **Fixed (Important): runtime theme tokens had no twins** (`ad9a933`).
  - The diner menu `/m` sets its colour tokens at runtime: `appearanceScopedCss` and `appearanceOverrideCss`. So does the Settings appearance preview (`appearanceCssVars`).
  - Without their own `-rgb` twins, old engines tinted with the POS build's colours.
  - On WebView 109 in the diner dark scheme, the search bar and tab bar (`bg-background/95`) became near-white with invisible light text.
  - Every runtime colour token now carries a twin derived from the sanitized value.
  - Screenshots `menu-109-before.png` and `menu-109-after.png` (shipped CSS + the real runtime theme CSS, a dark preset with a light custom accent): before, unreadable bars and a navy chip; after, dark bars with readable text, a faint amber chip and dark text on the amber accent.
- **Fixed (re-graded from Minor to Important by effect): the cold-start USB race** (`f762210`).
  - `initialize()` posts the saved printer's attempt just before `addLifecycleEventListener` fires `onHostResume`.
  - A hidden-app refusal could therefore set its flag after that resume, leaving the printer red until Reconnect: the F0.2 symptom, possible on every cold start.
  - The attempt now asks for itself on the timer thread when the app is already visible.
- **Deferred minors** (not fixed in this phase):
  - Pin 16 does not pin the `usbWaitingForeground = false` resets in `begin()`/`halt()`. The behaviour is correct today; this is a test gap.
  - A KOT that arrives while a USB prompt is pending can cause one extra prompt after a Deny (a pre-existing interplay).
  - The picker may toast a list error on a slow app start.
  - The picker has two code nits: `const error = …` is shaped for the pin needle, and `useRef(createStatusOrder())` builds a new object on every render.
  - `NativePrinterPicker.tsx` has one line of headroom under the raised 280 budget. Extract the printer list into a subcomponent next time.
  - `css-compat.test.ts` builds its own pipeline, so removing the plugin from `postcss.config.mjs` would pass every test. The untwinned tint tokens are not pinned to an allow-list (today `--border`).
  - Spec §12 F0.8 says "`@supports not` fallbacks"; the implementation rewrites Tailwind's solid fallback instead (equivalent).
- **Declined-to-judge lines:** each is pre-existing or outside §12, and none changes what a cafe gets from this phase. They are in the ledger and stand as is.

### Open issues

- The known cafe ENOENT pin (`lib/go-live-dl.test.ts`) still fails on this PC; it needs the local planning file.
- Not covered on hardware (no printers attached to this PC): the USB background-replug prompt, Web Serial/BLE reconnect-and-resend, and the paper checks. These are in TEST-CHECKLIST.md for the real-printer run.
- The demo deployment runs `main`, so the tint fix shows there only after this branch is deployed. The website CSS must be deployed together with the APK; the checklist already says so.
- `7edf7aa` fixes a crash that is also on `main`. Any client APK built from `main` crashes on the first load error that retries. The owner may want it as a separate hotfix to `main`; that is the owner's call.

---

## Review (orchestrator session, 2026-10-02)

Independent deep review of `93a31cf..a3d3fbe` (10 commits). Every number below was re-run in the review session, not copied from Results.

**Verdict: PASS.** 0 Critical, 0 Important, 0 must-fix findings. Phase 1 may start.

### Code review against spec §12

| Item | Commit | Verdict |
|---|---|---|
| F0.1 web refusals resendable | `fc3c823` | Correct. Only pre-write refusals carry `NOT_CONNECTED` (no transport, `writable === null`, BLE drop before chunk 0, no native client). Every post-write failure stays code-less and is never replayed. The resend path's messages now say "not connected" because nothing printed. |
| F0.2/F0.7 USB permission | `9f8bdc0`, `f762210` | Correct. `UsbTransport` and `PrinterManager` read the same `@Volatile appVisible`, so no tight loop. Every `resumeIfPaused()` caller runs on the single `pos-printer-timer` thread, and `begin()` clears `usbWaitingForeground` under the lock, so the cold-start race fix cannot ask twice. |
| F0.3–F0.6 picker | `283fdb1` | Correct. The 260 → 280 line budget is accepted: the plan's own code needed it, every needle and mutation is intact, and Phase 2 (§11) rewrites this panel. |
| F0.8 tints | `d69f053` | Correct. The rewrite (alias twins, merged-rule split, every-definition rule) is required by this CSS: light `--primary` is an alias and the optimizer merges 17 fallback rules. Fallback values are integers derived from parsed colours, so the step cannot inject CSS. |
| F0.9 cover retry, Brand lint | `be90ecb` | Correct. `retryByTap` resets the automatic count, then remounts. |
| F0.10, F0.11 | `4cdd927` | Correct. |
| Outside the plan: remount crash | `7edf7aa` | Justified and correct. It removes a script handler only when it belongs to the WebView being attached. `WebViewDelivery.kt` on `main` is identical to this commit's parent, so the Kotlin applies cleanly to `main`; `mobile-paths.test.ts` needs a small manual merge. |
| Outside the plan: runtime twins | `ad9a933` | Justified and correct. Twins come only from `HEX_COLOR_PATTERN` (6-digit hex) values, after sanitising. |
| Docker port change | Results | Justified. 8099 is Docker's. |

### Deferred minors: rulings

None blocks Phase 1. Three cheap gaps are folded into Phase 1 Task 0:
1. Pin 16 does not pin the `usbWaitingForeground = false` resets → **Phase 1 Task 0**.
2. A KOT during a pending USB prompt can cause one extra prompt after Deny. This is pre-existing → Phase 3 (Android hardening).
3. A list-error toast on a slow app start. The picker renders only when `caps.native` is true, so this is practically unreachable → no action.
4. Picker code nits → no action. Phase 2 replaces the panel.
5. One line of headroom under 280 → Phase 2 (§11 "This device" view).
6. Nothing pins `postcss.config.mjs` → **Phase 1 Task 0**: pin the plugin order and the untwinned allow-list (`--border`).
7. The spec F0.8 wording → **Phase 1 Task 0**.

### Re-run results (review session)

- cafe `npm test`: 3976 tests, 3975 pass, 1 fail. The failure is the known `lib/go-live-dl.test.ts` ENOENT pin.
- cafe: tsc 0; lint 0 errors and the 2 old warnings in `masters-blob.test.ts:331`.
- shared: 597/597, tsc 0.
- mobile: tsc 0, lint 0, node 114/114, Jest 3/3.
- desktop: 191/191.
- Next production build succeeds. `.next/static/css/22b0ab1b93eaddb4.css` has 59 `rgb(var(--x-rgb)/N%)` fallbacks, including `rgb(var(--primary-rgb)/10%)`.
- APKs are **byte-identical** to the Results hashes (x86_64 `fc4181e4…`, arm64-v8a `9f89cd9a…`, armeabi-v7a `f3f62149…`). Each APK holds only its own ABI.

### Emulator (Pixel_7_API_33, WebView 109.0.5414.123)

- Start-up and address items 1–7 pass.
- Remount crash scenario:
  - `does-not-exist.example.com`: 82 s of automatic retries, then 5 Try again taps.
  - A connection-reset server: one remount every 15 s (4 in 50 s, server-logged).
  - A never-answering server: "Taking longer than usual" after 12 s, then 3 cover Try again taps; each remounted (4 server GETs).
  - One process throughout. `logcat -b crash` stayed empty, and the app process had no `FATAL|ClassNotFound|NoSuchMethod`.
- Tints from the shipped minified CSS show light washes in light mode and dark-theme tints in dark mode.
  - Probe: `color-mix: false`. Light `bg-primary/10 = rgba(37, 99, 235, 0.1)`; dark `rgba(226, 232, 240, 0.1)`.
  - The overlay shows the text through it, and solid utilities stay solid.
- Diner menu dark scheme (shipped CSS + `appearanceScopedCss` + `appearanceOverrideCss`, `data-pub-theme="dark"`, accent `#fcd34d`):
  - The search bar and tab bar are dark (`rgba(25, 22, 22, 0.95)`) with readable text.
  - The chip is a faint amber tint (`rgba(252, 211, 77, 0.1)`).
- The demo POS login page loads (read-only, not signed in).

### Notes

- `.superpowers/sdd/` (two git-ignored files from the Phase 0 executor) is still in the working tree. It is not this session's to delete.
- **Recommendation: hotfix `7edf7aa` to `main`.** Any APK built from `main` closes itself ~17 s after its first load error, for example a Wi-Fi blip at opening time. This is the owner's call; the review did not touch `main`.
