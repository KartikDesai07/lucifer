import { test } from "node:test";
import assert from "node:assert/strict";
import type { UseReactToPrintOptions } from "react-to-print";

import {
  desktopShell,
  isDesktopShell,
  serializePrintDocument,
  slipPrintOptions,
  setDesktopToast,
  DESKTOP_PRINT_EMPTY_MESSAGE,
  DESKTOP_PRINT_FAILED_MESSAGE,
  DESKTOP_PRINT_HTML_MAX_CHARS,
  DESKTOP_PRINT_NO_REPLY_MESSAGE,
  DESKTOP_PRINT_TIMEOUT_MS,
  DESKTOP_PRINT_TOO_LARGE_MESSAGE,
  setDesktopPrintTimeoutMs,
  shellErrorMessage,
  type PosDesktopBridge,
} from "@/lib/desktop-shell";
import { inlineStylesheets, printDocumentHasText, serializePrintDocument as serializePrintDocumentFromDocumentModule } from "@/lib/desktop-shell-document";

// CB-D1 Slice C2 (plan §3, C2) — desktop-shell.ts is the seam between the
// cafe web app and the optional Windows desktop shell. It is capability-keyed
// ONLY (no navigator.userAgent, no "Electron" anywhere — see
// desktop-shell-paths.test.ts's raw-byte pin), so every test here drives it
// through a fake `globalThis.window` + a fake iframe rather than a real
// Electron bridge. Globals are restored in t.after so one test's fake window
// can never leak into the next.

type FakeWindow = { posDesktop?: PosDesktopBridge };

function installWindow(win: FakeWindow | undefined): void {
  if (win === undefined) {
    delete (globalThis as unknown as { window?: unknown }).window;
  } else {
    (globalThis as unknown as { window: FakeWindow }).window = win;
  }
}

// A minimal fake HTMLIFrameElement: only the `contentDocument` shape
// serializePrintDocument actually reads (doc.title, doc.documentElement.outerHTML).
function fakeIframe(outerHTML: string, withDoc = true): HTMLIFrameElement {
  const doc = {
    title: "",
    documentElement: { outerHTML },
  };
  const contentDocument = withDoc ? doc : null;
  return { contentDocument } as unknown as HTMLIFrameElement;
}

test("desktopShell(): no window at all → null, and isDesktopShell() → false", (t) => {
  installWindow(undefined);
  t.after(() => installWindow(undefined));

  assert.equal(desktopShell(), null);
  assert.equal(isDesktopShell(), false);
});

test("desktopShell(): window present but without posDesktop → null (same as no shell)", (t) => {
  installWindow({});
  t.after(() => installWindow(undefined));

  assert.equal(desktopShell(), null);
  assert.equal(isDesktopShell(), false);
});

test("desktopShell(): posDesktop present but printHtml is not a function → null", (t) => {
  installWindow({
    posDesktop: { version: "1.0.0", printHtml: "nope" as unknown as PosDesktopBridge["printHtml"] },
  });
  t.after(() => installWindow(undefined));

  assert.equal(desktopShell(), null);
  assert.equal(isDesktopShell(), false);
});

test("slipPrintOptions(): no shell → returns the SAME object reference, untouched", (t) => {
  installWindow(undefined);
  t.after(() => installWindow(undefined));

  const options = { documentTitle: "Receipt", pageStyle: "@page { size: 80mm; }" };
  const result = slipPrintOptions(options);

  assert.strictEqual(result, options, "no-shell case must return the identical object reference");
});

test("slipPrintOptions(): with a shell, the print override serializes the iframe to a string starting with <!DOCTYPE html>, containing a marker, and calls shell.printHtml with it; other option keys are unchanged", async (t) => {
  const calls: string[] = [];
  const bridge: PosDesktopBridge = {
    version: "1.0.0",
    printHtml: async (html: string) => {
      calls.push(html);
    },
  };
  installWindow({ posDesktop: bridge });
  t.after(() => installWindow(undefined));

  const MARKER = "KOT-MARKER-42";
  const options: UseReactToPrintOptions = {
    pageStyle: "@page { size: 80mm; }",
    documentTitle: "Receipt",
    onAfterPrint: () => {},
  };
  const wrapped = slipPrintOptions(options);

  assert.equal(wrapped.pageStyle, options.pageStyle, "pageStyle must be unchanged");
  assert.equal(typeof wrapped.print, "function", "wrapped options must carry a print override");

  const iframe = fakeIframe(`<html><head></head><body>${MARKER}</body></html>`);
  await wrapped.print!(iframe);

  assert.equal(calls.length, 1, "shell.printHtml must be called exactly once");
  assert.ok(calls[0].startsWith("<!DOCTYPE html>"), "the serialized document must start with <!DOCTYPE html>");
  assert.ok(calls[0].includes(MARKER), "the serialized document must contain the iframe's own content marker");
});

test("serializePrintDocument(): a string documentTitle sets doc.title before serializing", () => {
  const iframe = fakeIframe("<html><head></head><body>x</body></html>");
  const result = serializePrintDocument(iframe, "My Receipt Title");

  assert.equal(iframe.contentDocument!.title, "My Receipt Title", "doc.title must be set to the given string");
  assert.ok(result.startsWith("<!DOCTYPE html>"));
});

test("serializePrintDocument(): a function documentTitle is resolved (called) and its return value sets doc.title", () => {
  // slipPrintOptions resolves documentTitle before calling serializePrintDocument
  // (resolveTitle), so this exercises that resolution end-to-end through the
  // wrapped print() override rather than assuming serializePrintDocument itself
  // accepts a function — its own signature takes a resolved string | undefined.
  let called = false;
  const titleFn = () => {
    called = true;
    return "Computed Title";
  };

  const bridge: PosDesktopBridge = { version: "1.0.0", printHtml: async () => {} };
  const globalWin = { posDesktop: bridge };
  installWindow(globalWin);

  return (async () => {
    try {
      const wrapped = slipPrintOptions<UseReactToPrintOptions>({ documentTitle: titleFn });
      const iframe = fakeIframe("<html><head></head><body>y</body></html>");
      await wrapped.print!(iframe);

      assert.ok(called, "the function documentTitle must be invoked (resolved), not passed through as-is");
      assert.equal(iframe.contentDocument!.title, "Computed Title");
    } finally {
      installWindow(undefined);
    }
  })();
});

test("serializePrintDocument(): undefined documentTitle leaves doc.title untouched", () => {
  const iframe = fakeIframe("<html><head></head><body>z</body></html>");
  iframe.contentDocument!.title = "Untouched";

  serializePrintDocument(iframe, undefined);

  assert.equal(iframe.contentDocument!.title, "Untouched", "doc.title must be left alone when no title is given");
});

test("serializePrintDocument(): a missing contentDocument throws, and the shell's printHtml is never called", async (t) => {
  let printHtmlCalled = false;
  const bridge: PosDesktopBridge = {
    version: "1.0.0",
    printHtml: async () => {
      printHtmlCalled = true;
    },
  };
  installWindow({ posDesktop: bridge });
  t.after(() => installWindow(undefined));

  assert.throws(() => serializePrintDocument(fakeIframe("", false), undefined));

  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  await assert.rejects(() => wrapped.print!(fakeIframe("", false)));
  assert.equal(printHtmlCalled, false, "printHtml must never be called when the iframe has no contentDocument");
});

test("the default onPrintError (rejection path): setDesktopToast(capture) → invoking the returned onPrintError sets toast === DESKTOP_PRINT_FAILED_MESSAGE exactly, AND calls the caller's onAfterPrint", (t) => {
  installWindow({ posDesktop: { version: "1.0.0", printHtml: async () => {} } });
  t.after(() => installWindow(undefined));

  let toastMessage: string | undefined;
  setDesktopToast((message) => {
    toastMessage = message;
  });
  t.after(() => setDesktopToast(() => {}));

  let onAfterPrintCalled = false;
  const options: UseReactToPrintOptions = {
    onAfterPrint: () => {
      onAfterPrintCalled = true;
    },
  };
  const wrapped = slipPrintOptions(options);

  assert.equal(typeof wrapped.onPrintError, "function", "a default onPrintError must be synthesized");
  wrapped.onPrintError!("print", new Error("driver failure"));

  assert.equal(toastMessage, DESKTOP_PRINT_FAILED_MESSAGE, "the toast must receive DESKTOP_PRINT_FAILED_MESSAGE exactly");
  assert.equal(onAfterPrintCalled, true, "the caller's onAfterPrint bookkeeping must still run on a failed silent print");
});

test("caller's own onPrintError is preserved by identity and the desktop toast is never called", (t) => {
  installWindow({ posDesktop: { version: "1.0.0", printHtml: async () => {} } });
  t.after(() => installWindow(undefined));

  let toastCalled = false;
  setDesktopToast(() => {
    toastCalled = true;
  });
  t.after(() => setDesktopToast(() => {}));

  const ownOnPrintError = (_loc: "onBeforePrint" | "print", _err: Error) => {};
  const wrapped = slipPrintOptions({ onPrintError: ownOnPrintError });

  assert.strictEqual(wrapped.onPrintError, ownOnPrintError, "a caller-supplied onPrintError must be preserved by identity, never wrapped");

  wrapped.onPrintError!("print", new Error("whatever"));
  assert.equal(toastCalled, false, "the desktop toast must never fire when the caller supplied its own onPrintError");
});

test("happy path with a throwing navigator.userAgent getter → no throw (desktop-shell.ts is capability-keyed only and must never read navigator.userAgent)", async (t) => {
  const realNavigator = (globalThis as unknown as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    get() {
      throw new Error("navigator.userAgent must never be read by desktop-shell.ts");
    },
  });
  t.after(() => {
    if (realNavigator === undefined) {
      delete (globalThis as unknown as { navigator?: unknown }).navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: realNavigator, writable: true });
    }
  });

  installWindow({ posDesktop: { version: "1.0.0", printHtml: async () => {} } });
  t.after(() => installWindow(undefined));

  const wrapped = slipPrintOptions<UseReactToPrintOptions>({ documentTitle: "Slip" });
  const iframe = fakeIframe("<html><head></head><body>ok</body></html>");

  await assert.doesNotReject(() => wrapped.print!(iframe));
  assert.equal(isDesktopShell(), true);
});

// ── Review fix round (2026-09-08): charset, size mirror, no-reply timeout, shell messages ──

test("serializePrintDocument(): injects <meta charset=\"utf-8\"> into <head> when the iframe document has none, and never duplicates an existing one", () => {
  const injected = serializePrintDocument(fakeIframe("<html><head><title>t</title></head><body><div>x</div></body></html>"), undefined);
  assert.ok(injected.startsWith("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>t</title>"), "charset meta must be the first child of <head>");
  const kept = serializePrintDocument(fakeIframe("<html><head><meta charset=\"utf-8\"><title>t</title></head><body></body></html>"), undefined);
  assert.equal((kept.match(/<meta[^>]+charset/gi) ?? []).length, 1, "an existing charset meta must not be duplicated");
});

test("the print override refuses a document larger than DESKTOP_PRINT_HTML_MAX_CHARS with DESKTOP_PRINT_TOO_LARGE_MESSAGE and never calls printHtml", async (t) => {
  t.after(() => installWindow(undefined));
  let calls = 0;
  installWindow({ posDesktop: { version: "1", printHtml: () => { calls++; return Promise.resolve(); } } });
  const huge = "<html><head></head><body>" + "x".repeat(DESKTOP_PRINT_HTML_MAX_CHARS) + "</body></html>";
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  await assert.rejects(wrapped.print!(fakeIframe(huge)), { message: DESKTOP_PRINT_TOO_LARGE_MESSAGE });
  assert.equal(calls, 0, "the shell must never receive an over-size document");
});

test("the print override gives up with DESKTOP_PRINT_NO_REPLY_MESSAGE when the shell never answers (bounded by the seam's own timeout, which outlasts the shell's job deadline)", async (t) => {
  t.after(() => {
    installWindow(undefined);
    setDesktopPrintTimeoutMs(DESKTOP_PRINT_TIMEOUT_MS);
  });
  installWindow({ posDesktop: { version: "1", printHtml: () => new Promise<void>(() => undefined) } });
  setDesktopPrintTimeoutMs(20);
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  await assert.rejects(wrapped.print!(fakeIframe("<html><head></head><body>slip</body></html>")), { message: DESKTOP_PRINT_NO_REPLY_MESSAGE });
  assert.ok(DESKTOP_PRINT_TIMEOUT_MS > 30_000, "the seam waits longer than the shell's 30 s job deadline so the shell's own message wins when it answers");
});

test("shellErrorMessage(): keeps the shell's sentence out of Electron's IPC wrapper, keeps the seam's own messages, and shows the generic text for anything else", () => {
  const wrapped = new Error("Error invoking remote method 'pos-desktop:print-html': Error: The printer did not answer. Check the printer and print again.");
  assert.equal(shellErrorMessage(wrapped), "The printer did not answer. Check the printer and print again.");
  assert.equal(shellErrorMessage(new Error(DESKTOP_PRINT_TOO_LARGE_MESSAGE)), DESKTOP_PRINT_TOO_LARGE_MESSAGE);
  assert.equal(shellErrorMessage(new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE)), DESKTOP_PRINT_NO_REPLY_MESSAGE);
  assert.equal(shellErrorMessage(new Error("serializePrintDocument: iframe has no contentDocument")), DESKTOP_PRINT_FAILED_MESSAGE, "internal errors never reach the operator verbatim");
  assert.equal(shellErrorMessage(new Error("Error invoking remote method 'x': Error: " + "y".repeat(400))), DESKTOP_PRINT_FAILED_MESSAGE, "an over-long sentence falls back");
  assert.equal(shellErrorMessage(new Error("Error invoking remote method 'x': Error: ")), DESKTOP_PRINT_FAILED_MESSAGE, "an empty sentence falls back");
  assert.equal(shellErrorMessage("not an error"), DESKTOP_PRINT_FAILED_MESSAGE);
});

test("the default onPrintError toasts the shell's own sentence for an IPC-wrapped rejection and still calls onAfterPrint", (t) => {
  t.after(() => {
    installWindow(undefined);
    setDesktopToast(() => undefined);
  });
  installWindow({ posDesktop: { version: "1", printHtml: () => Promise.resolve() } });
  let toastMessage: string | null = null;
  setDesktopToast((m) => { toastMessage = m; });
  let after = 0;
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({ onAfterPrint: () => { after++; } });
  wrapped.onPrintError!("print", new Error("Error invoking remote method 'pos-desktop:print-html': Error: Printing failed: Invalid deviceName provided"));
  assert.equal(toastMessage, "Printing failed: Invalid deviceName provided");
  assert.equal(after, 1, "bookkeeping must still unblock");
});

// ── Blank-slip fence (2026-09-11, owner: a print must NEVER come out blank) ──

test("the print override refuses a document with no visible body text (style-only body) with DESKTOP_PRINT_EMPTY_MESSAGE and never calls printHtml", async (t) => {
  t.after(() => installWindow(undefined));
  let calls = 0;
  installWindow({ posDesktop: { version: "1", printHtml: () => { calls++; return Promise.resolve(); } } });
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  const iframe = fakeIframe("<html><head><style>x{}</style></head><body></body></html>");
  await assert.rejects(wrapped.print!(iframe), { message: DESKTOP_PRINT_EMPTY_MESSAGE });
  assert.equal(calls, 0, "printHtml must never be called for a blank slip");
});

test("the print override refuses a document whose body is only &nbsp; and whitespace with DESKTOP_PRINT_EMPTY_MESSAGE and never calls printHtml", async (t) => {
  t.after(() => installWindow(undefined));
  let calls = 0;
  installWindow({ posDesktop: { version: "1", printHtml: () => { calls++; return Promise.resolve(); } } });
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  const iframe = fakeIframe("<html><head></head><body>&nbsp;  \n  </body></html>");
  await assert.rejects(wrapped.print!(iframe), { message: DESKTOP_PRINT_EMPTY_MESSAGE });
  assert.equal(calls, 0, "printHtml must never be called for an nbsp/whitespace-only slip");
});

test("the print override still prints a document that carries real body text", async (t) => {
  t.after(() => installWindow(undefined));
  let calls = 0;
  installWindow({ posDesktop: { version: "1", printHtml: () => { calls++; return Promise.resolve(); } } });
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  const iframe = fakeIframe("<html><head><style>x{}</style></head><body>Filter Coffee x2</body></html>");
  await wrapped.print!(iframe);
  assert.equal(calls, 1, "printHtml must be called exactly once for a slip with real text");
});

test("shellErrorMessage(new Error(DESKTOP_PRINT_EMPTY_MESSAGE)) returns it verbatim", () => {
  assert.equal(shellErrorMessage(new Error(DESKTOP_PRINT_EMPTY_MESSAGE)), DESKTOP_PRINT_EMPTY_MESSAGE);
});

// ── printDocumentHasText (lib/desktop-shell-document.ts) ────────────────────

test("printDocumentHasText: head-only text (title, no body text) is ignored — false", () => {
  assert.equal(printDocumentHasText("<html><head><title>Some Title</title></head><body></body></html>"), false);
});

test("printDocumentHasText: style and script blocks (outside head) are ignored — false", () => {
  assert.equal(
    printDocumentHasText("<html><head></head><body><style>.a{content:\"x\"}</style><script>var x = 'y';</script></body></html>"),
    false,
  );
});

test("printDocumentHasText: nbsp entities (numeric, hex, and named) are ignored — false", () => {
  assert.equal(printDocumentHasText("<html><head></head><body>&nbsp;&#160;&#xa0;</body></html>"), false);
});

test("printDocumentHasText: real body text — true", () => {
  assert.equal(printDocumentHasText("<html><head></head><body><div>Filter Coffee</div></body></html>"), true);
});

// ── inlineStylesheets (lib/desktop-shell-document.ts) ────────────────────────

interface FakeSheet {
  cssRules: { cssText: string }[];
}

interface FakeLink {
  tagName: "LINK";
  sheet: FakeSheet | null | (() => never);
  replaceWith: (node: unknown) => void;
  remove: () => void;
}

function fakeLink(sheet: FakeLink["sheet"]): FakeLink {
  return { tagName: "LINK", sheet, replaceWith: () => {}, remove: () => {} };
}

test("inlineStylesheets: replaces a readable stylesheet <link> with an inline <style> carrying its rules, leaves a throwing-sheet link and a null-sheet link alone, removes a link[as=\"style\"] preload, and returns the inlined count", () => {
  const readableLink: FakeLink & { replaceWith: (node: unknown) => void } = fakeLink({ cssRules: [{ cssText: ".a{color:red}" }] });
  const replacedWithBox: { current: { textContent: string } | null } = { current: null };
  readableLink.replaceWith = (node: unknown) => {
    replacedWithBox.current = node as { textContent: string };
  };

  // inlineStylesheets reads `link.sheet` unguarded (only the cssRules
  // iteration is wrapped in try/catch) — the real cross-origin case is a
  // readable `sheet` object whose `cssRules` getter throws a SecurityError.
  const throwingLink = fakeLink({
    get cssRules(): { cssText: string }[] {
      throw new Error("cross-origin stylesheet: cssRules is not readable");
    },
  } as unknown as FakeSheet);
  let throwingLinkTouched = false;
  throwingLink.replaceWith = () => { throwingLinkTouched = true; };

  const nullSheetLink = fakeLink(null);
  let nullSheetLinkTouched = false;
  nullSheetLink.replaceWith = () => { nullSheetLinkTouched = true; };

  let preloadRemoved = false;
  const preloadLink = { tagName: "LINK", remove: () => { preloadRemoved = true; } };

  const createdStyles: { textContent: string }[] = [];
  const fakeDoc = {
    querySelectorAll: (selector: string) => {
      if (selector === 'link[rel~="stylesheet"]') return [readableLink, throwingLink, nullSheetLink];
      if (selector === 'link[as="style"]') return [preloadLink];
      return [];
    },
    createElement: (tag: string) => {
      assert.equal(tag, "style", "inlineStylesheets must create a <style> element");
      const el = { textContent: "" };
      createdStyles.push(el);
      return el;
    },
  } as unknown as Document;

  const inlinedCount = inlineStylesheets(fakeDoc);

  const replacedWith = replacedWithBox.current;
  if (!replacedWith) throw new Error("the readable link's replaceWith must have been called");
  assert.ok(replacedWith.textContent.includes(".a{color:red}"), "the inlined <style> must carry the sheet's rules cssText");
  assert.equal(throwingLinkTouched, false, "a link whose sheet getter throws must be left alone");
  assert.equal(nullSheetLinkTouched, false, "a link with sheet: null must be left alone");
  assert.equal(preloadRemoved, true, "the link[as=\"style\"] preload must have remove() called");
  assert.equal(inlinedCount, 1, "exactly one sheet (the readable one) must be reported as inlined");
});

test("inlineStylesheets: a fake document WITHOUT querySelectorAll is inert and returns 0", () => {
  const bareDoc = {} as unknown as Document;
  assert.equal(inlineStylesheets(bareDoc), 0);
});

// ── serializePrintDocument re-export identity + calls inlineStylesheets ─────

test("serializePrintDocument imported from @/lib/desktop-shell and from @/lib/desktop-shell-document are the SAME function", () => {
  assert.strictEqual(serializePrintDocument, serializePrintDocumentFromDocumentModule);
});

test("serializePrintDocument calls inlineStylesheets — a fake doc whose querySelectorAll records the call sees it invoked", () => {
  let querySelectorAllCalls = 0;
  const iframe = {
    contentDocument: {
      title: "",
      documentElement: { outerHTML: "<html><head></head><body>x</body></html>" },
      querySelectorAll: (_selector: string) => {
        querySelectorAllCalls += 1;
        return [];
      },
    },
  } as unknown as HTMLIFrameElement;

  serializePrintDocument(iframe, undefined);

  assert.ok(querySelectorAllCalls > 0, "serializePrintDocument must call inlineStylesheets, which calls doc.querySelectorAll at least once");
});
