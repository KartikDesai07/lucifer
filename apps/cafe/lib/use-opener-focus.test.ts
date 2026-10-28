// U2 verification fix (2026-10-23; V-C F4): hooks/use-opener-focus.ts (U1 ruling P22) as behaviour. A Radix dialog opened
// from its caller's state has no trigger, so its focus fell to <body> on close; the hook remembers what had the focus as
// the dialog opens and gives it back as it closes. By default the panel itself takes the focus on open (the /pos sheets:
// no ring on a first control, no phone keyboard for a field) — byte-for-byte as before for its callers; with
// `focusPanel: false` (the Orders cancel sheet, Ruling P17: its reason field keeps the focus on open) Radix's own open
// focus stays and only the opener is remembered. The handlers run against a stubbed DOM (activeElement, focus,
// isConnected), captured from one server render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useOpenerFocus } from "@/hooks/use-opener-focus";

type Handlers = ReturnType<typeof useOpenerFocus>;

/** The hook as its callers call it: the /pos sheets and the order detail with no options, the cancel sheet with one. */
function useDefaultForm(): Handlers {
  return useOpenerFocus();
}
function useFieldFirstForm(): Handlers {
  return useOpenerFocus({ focusPanel: false });
}

/** The hook's handlers, as one render of a component returns them. */
function handlersOf(useHook: () => Handlers): Handlers {
  let got: Handlers | null = null;
  function Probe() {
    got = useHook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(got, "landmark: the hook ran in a render");
  return got!;
}

/** A stubbed DOM: an HTMLElement class whose focus() moves document.activeElement, and the document. */
function stubDom() {
  const g = globalThis as { HTMLElement?: unknown; document?: unknown };
  const saved = { HTMLElement: g.HTMLElement, document: g.document };
  const doc: { activeElement: unknown } = { activeElement: null };
  class FakeElement {
    isConnected = true;
    focusCalls = 0;
    constructor(readonly name: string) {}
    focus(): void {
      this.focusCalls += 1;
      doc.activeElement = this;
    }
  }
  g.HTMLElement = FakeElement;
  g.document = doc;
  const restore = () => {
    g.HTMLElement = saved.HTMLElement;
    g.document = saved.document;
  };
  return { doc, el: (name: string) => new FakeElement(name), restore };
}

/** A focus event as Radix passes it: preventDefault and the dialog's Content as currentTarget. */
function focusEvent(currentTarget: unknown) {
  const e = { defaultPrevented: false, currentTarget, preventDefault: () => (e.defaultPrevented = true) };
  return e;
}

test("useOpenerFocus(): the panel takes the focus on open (Radix's first-control focus prevented); the opener gets it back on close (ruling P22, unchanged)", () => {
  const { doc, el, restore } = stubDom();
  try {
    const h = handlersOf(useDefaultForm);
    const opener = el("Pay button");
    const panel = el("panel");
    doc.activeElement = opener;
    const open = focusEvent(panel);
    h.onOpenAutoFocus(open as unknown as Event);
    assert.equal(open.defaultPrevented, true, "Radix's own open focus (the first control) is prevented");
    assert.equal(panel.focusCalls, 1, "the panel itself takes the focus");
    assert.equal(doc.activeElement, panel, "the focus is on the panel");
    const close = focusEvent(panel);
    h.onCloseAutoFocus(close as unknown as Event);
    assert.equal(close.defaultPrevented, true, "Radix's own close focus (the missing trigger: <body>) is prevented");
    assert.equal(opener.focusCalls, 1, "the opener is focused again");
    assert.equal(doc.activeElement, opener, "the focus is back on what opened the dialog");
  } finally {
    restore();
  }
});

test("useOpenerFocus({ focusPanel: false }): Radix's open focus stays (the first control: the cancel sheet's reason field, Ruling P17); the opener still gets the focus back on close", () => {
  const { doc, el, restore } = stubDom();
  try {
    const h = handlersOf(useFieldFirstForm);
    const opener = el("Cancel this order");
    const panel = el("panel");
    doc.activeElement = opener;
    const open = focusEvent(panel);
    h.onOpenAutoFocus(open as unknown as Event);
    assert.equal(open.defaultPrevented, false, "Radix's own open focus is NOT prevented: it focuses the first control (the field)");
    assert.equal(panel.focusCalls, 0, "the panel does not take the focus");
    const field = el("reason field");
    field.focus(); // what Radix does once the event is not prevented
    const close = focusEvent(panel);
    h.onCloseAutoFocus(close as unknown as Event);
    assert.equal(close.defaultPrevented, true, "Radix's own close focus (no trigger: <body>) is prevented");
    assert.equal(opener.focusCalls, 1, "the opener (the danger link) is focused again");
    assert.equal(doc.activeElement, opener, "the focus is back on what opened the sheet, not on <body>");
  } finally {
    restore();
  }
});

test("useOpenerFocus: an opener gone from the page by the close is not focused (both forms); nothing is remembered when no element had the focus", () => {
  const { doc, el, restore } = stubDom();
  try {
    for (const h of [handlersOf(useDefaultForm), handlersOf(useFieldFirstForm)]) {
      const opener = el("row");
      const panel = el("panel");
      doc.activeElement = opener;
      h.onOpenAutoFocus(focusEvent(panel) as unknown as Event);
      opener.isConnected = false; // e.g. the danger link of an order cancelled meanwhile
      h.onCloseAutoFocus(focusEvent(panel) as unknown as Event);
      assert.equal(opener.focusCalls, 0, "a removed opener is never focused");
    }
    const h = handlersOf(useFieldFirstForm);
    const panel = el("panel");
    doc.activeElement = { not: "an element" };
    h.onOpenAutoFocus(focusEvent(panel) as unknown as Event);
    const close = focusEvent(panel);
    h.onCloseAutoFocus(close as unknown as Event);
    assert.equal(close.defaultPrevented, true, "the close focus is still Radix-free");
    assert.equal(panel.focusCalls, 0, "and nothing is focused");
  } finally {
    restore();
  }
});

