// Behavior tables for the pure half of the in-app "Discard changes?" guard
// (lib/leave-guard.ts). The React/DOM half is pinned in leave-guard-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LEAVE_GUARD_MARK,
  guardedLinkHref,
  isLeaveGuardEntry,
  createLeaveGuardHistory,
  leaveGuardEntryState,
  popstateDecision,
  type HistoryPort,
  type LeaveGuardAnchor,
  type LeaveGuardClick,
  type LeaveGuardHistory,
} from "@/lib/leave-guard";

const HERE = "https://cafe.example.com/settings/bill-print";

const plainClick: LeaveGuardClick = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};
const link = (href: string, over: Partial<LeaveGuardAnchor> = {}): LeaveGuardAnchor => ({
  href,
  target: "",
  download: false,
  ...over,
});

test("guardedLinkHref: a plain click to another settings path returns pathname+search+hash", () => {
  assert.equal(guardedLinkHref(plainClick, link("https://cafe.example.com/settings/taxes"), HERE), "/settings/taxes");
  assert.equal(
    guardedLinkHref(plainClick, link("https://cafe.example.com/settings/taxes?x=1#gst"), HERE),
    "/settings/taxes?x=1#gst",
  );
});

test("guardedLinkHref: same pathname with a different search is guarded", () => {
  assert.equal(
    guardedLinkHref(plainClick, link("https://cafe.example.com/settings/bill-print?tab=2"), HERE),
    "/settings/bill-print?tab=2",
  );
});

test("guardedLinkHref: same pathname+search with only a #hash is NOT guarded (jump link)", () => {
  assert.equal(guardedLinkHref(plainClick, link("https://cafe.example.com/settings/bill-print#bill-preview"), HERE), null);
});

test("guardedLinkHref: modifiers, non-primary button and defaultPrevented are never guarded", () => {
  const to = link("https://cafe.example.com/settings/taxes");
  for (const over of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    assert.equal(guardedLinkHref({ ...plainClick, ...over }, to, HERE), null, JSON.stringify(over));
  }
});

test("guardedLinkHref: target and download", () => {
  const url = "https://cafe.example.com/settings/taxes";
  assert.equal(guardedLinkHref(plainClick, link(url, { target: "_blank" }), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link(url, { target: "_self" }), HERE), "/settings/taxes");
  assert.equal(guardedLinkHref(plainClick, link(url, { download: true }), HERE), null);
});

test("guardedLinkHref: cross-origin, mailto:, tel:, javascript: and unparsable hrefs are not guarded", () => {
  assert.equal(guardedLinkHref(plainClick, link("https://other.example.org/settings/taxes"), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link("mailto:owner@example.com"), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link("tel:+911234567890"), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link("javascript:void(0)"), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link("http://"), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link(""), HERE), null);
  assert.equal(guardedLinkHref(plainClick, link("https://cafe.example.com/settings/taxes"), "not a url"), null);
});

test("isLeaveGuardEntry: true only for an object marked true", () => {
  assert.equal(isLeaveGuardEntry(null), false);
  assert.equal(isLeaveGuardEntry(undefined), false);
  assert.equal(isLeaveGuardEntry("x"), false);
  assert.equal(isLeaveGuardEntry({}), false);
  assert.equal(isLeaveGuardEntry({ [LEAVE_GUARD_MARK]: false }), false);
  assert.equal(isLeaveGuardEntry({ [LEAVE_GUARD_MARK]: "true" }), false);
  assert.equal(isLeaveGuardEntry({ [LEAVE_GUARD_MARK]: true }), true);
});

test("leaveGuardEntryState: keeps Next's own keys, adds the mark, tolerates null/non-object", () => {
  const tree = ["", {}];
  const out = leaveGuardEntryState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree });
  assert.equal(out.__NA, true);
  assert.equal(out.__PRIVATE_NEXTJS_INTERNALS_TREE, tree);
  assert.equal(out[LEAVE_GUARD_MARK], true);
  assert.equal(isLeaveGuardEntry(out), true);
  assert.deepEqual(leaveGuardEntryState(null), { [LEAVE_GUARD_MARK]: true });
  assert.deepEqual(leaveGuardEntryState("str"), { [LEAVE_GUARD_MARK]: true });
  assert.deepEqual(leaveGuardEntryState(undefined), { [LEAVE_GUARD_MARK]: true });
});

test("popstateDecision: every branch", () => {
  const marked = { [LEAVE_GUARD_MARK]: true };
  const own = { __NA: true };
  const base = { sameHref: true, state: own, dirty: true };
  assert.equal(popstateDecision({ ...base, sameHref: false }), "ignore");
  assert.equal(popstateDecision({ ...base, state: null }), "ignore");
  assert.equal(popstateDecision({ ...base, state: undefined }), "ignore");
  assert.equal(popstateDecision({ ...base, state: "s" }), "ignore");
  assert.equal(popstateDecision({ ...base, state: marked }), "ignore");
  assert.equal(popstateDecision({ ...base, dirty: true }), "prompt");
  assert.equal(popstateDecision({ ...base, dirty: false }), "continue-back");
});

// --- history controller, driven through a fake browser history -------------
// Mimics the parts of Next 15.5 the guard depends on: every entry Next owns
// carries { __NA, tree }; router.refresh() replaces the CURRENT entry with a
// fresh { __NA, tree } (dropping our mark); a Next push to another page
// unmounts the settings page (its controller stops receiving popstate).
const ORIGIN = "https://cafe.example.com";
const HOME = `${ORIGIN}/`;
const SETTINGS = `${ORIGIN}/settings/bill-print`;
const OTHER = `${ORIGIN}/settings/taxes`;
const MAX_DELIVERY_DEPTH = 8;
const nextState = (href: string): Record<string, unknown> => ({ __NA: true, tree: href });

class FakeHistory implements HistoryPort {
  entries: { state: unknown; href: string }[];
  index: number;
  current: LeaveGuardHistory | null = null;
  prompts = 0;
  private depth = 0;

  constructor(hrefs: string[]) {
    this.entries = hrefs.map((href) => ({ state: nextState(href), href }));
    this.index = this.entries.length - 1;
  }
  get state(): unknown {
    return this.entries[this.index].state;
  }
  get href(): string {
    return this.entries[this.index].href;
  }
  get top(): { state: unknown; href: string } {
    return this.entries[this.entries.length - 1];
  }
  push(state: Record<string, unknown> | null, href: string): void {
    this.entries.length = this.index + 1;
    this.entries.push({ state, href });
    this.index += 1;
  }
  replace(state: Record<string, unknown>, href: string): void {
    this.entries[this.index] = { state, href };
  }
  back(): void {
    this.go(-1);
  }
  forward(): void {
    this.go(1);
  }
  private go(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next >= this.entries.length) return;
    this.index = next;
    this.deliver(this.entries[this.index].state);
  }
  private deliver(state: unknown): void {
    if (!this.current) return;
    this.depth += 1;
    assert.ok(this.depth <= MAX_DELIVERY_DEPTH, "popstate delivery recursed too deep");
    try {
      this.current.onPopState(state);
    } finally {
      this.depth -= 1;
    }
  }
  refresh(): void {
    this.entries[this.index] = { state: nextState(this.href), href: this.href };
  }
  navigate(href: string): void {
    this.current = null;
    this.push(nextState(href), href);
  }
  // Browsers differ on whether a fragment navigation also fires popstate
  // (state null); hashchange always fires, so both shapes are exercised.
  fragment(hash: string, firesPopstate: boolean): void {
    this.push(null, this.href + hash);
    if (firesPopstate) this.deliver(null);
    this.current?.onHashChange();
  }
  mount(): LeaveGuardHistory {
    this.current = createLeaveGuardHistory(this, () => {
      this.prompts += 1;
    });
    return this.current;
  }
}

const at = (fake: FakeHistory): string => fake.href;

test("history: basic — dirty Back prompts on the page's own entry, Keep editing re-arms, leaveBack lands on the previous page", () => {
  const fake = new FakeHistory([HOME, SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  assert.equal(fake.entries.length, 3);
  assert.equal((fake.top.state as Record<string, unknown>).__NA, true, "the pushed guard entry keeps Next's own key");
  fake.back();
  assert.equal(fake.prompts, 1);
  assert.equal(at(fake), SETTINGS);
  ctl.keepEditing();
  assert.equal(fake.entries.length, 3);
  fake.back();
  assert.equal(fake.prompts, 2);
  ctl.leaveBack();
  assert.equal(at(fake), HOME);
});

test("history: R1-A — edit, save (refresh strips the mark), edit again re-marks in place instead of pushing a second guard entry", () => {
  const fake = new FakeHistory([HOME, SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  fake.refresh();
  ctl.setDirty(false);
  ctl.setDirty(true);
  assert.equal(fake.entries.length, 3, "no second guard entry");
  assert.equal(isLeaveGuardEntry(fake.top.state), true, "the top entry is marked again");
  assert.equal((fake.top.state as Record<string, unknown>).__NA, true, "the re-marked entry keeps Next's own key");
  fake.back();
  assert.equal(fake.prompts, 1);
  assert.equal(at(fake), SETTINGS);
  ctl.leaveBack();
  assert.equal(at(fake), HOME, "Discard on Back reaches the previous page");
});

test("history: R1-B — save strips the mark, leave, come Back to the stripped entry: one more Back reaches the previous page", () => {
  const fake = new FakeHistory([HOME, SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  fake.refresh();
  ctl.setDirty(false);
  fake.navigate(OTHER);
  fake.back();
  assert.equal(at(fake), SETTINGS);
  fake.mount();
  fake.back();
  assert.equal(at(fake), HOME, "no dead press");
  assert.equal(fake.prompts, 0);
});

test("history: R2 — Discard on Back at the tab's first entry (back is a no-op) leaves nothing stuck", () => {
  const fake = new FakeHistory([SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  fake.back();
  assert.equal(fake.prompts, 1);
  ctl.leaveBack();
  ctl.setDirty(true);
  fake.back();
  assert.equal(fake.prompts, 2, "the next Back prompts again");
});

test("history: a clean Back after the save-bar Discard is one press", () => {
  const fake = new FakeHistory([HOME, SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  ctl.setDirty(false);
  fake.back();
  assert.equal(at(fake), HOME);
  assert.equal(fake.prompts, 0);
});

test("history: a #hash jump then Back onto the guard entry never prompts (marked, and after a refresh stripped it)", () => {
  for (const [stripped, firesPopstate] of [[false, true], [true, true], [false, false], [true, false]]) {
    const fake = new FakeHistory([HOME, SETTINGS]);
    const ctl = fake.mount();
    ctl.setDirty(true);
    if (stripped) fake.refresh();
    fake.fragment("#bill-preview", firesPopstate);
    fake.back();
    assert.equal(fake.prompts, 0, `stripped=${stripped} firesPopstate=${firesPopstate}`);
    assert.equal(at(fake), SETTINGS);
  }
});

test("history: a Forward onto a marked guard entry is ignored", () => {
  const fake = new FakeHistory([HOME, SETTINGS]);
  const ctl = fake.mount();
  ctl.setDirty(true);
  fake.back();
  assert.equal(fake.prompts, 1);
  fake.forward();
  assert.equal(fake.prompts, 1);
  assert.equal(isLeaveGuardEntry(fake.state), true);
  assert.ok(ctl);
});
