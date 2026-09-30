// Source pins for the 2026-10-01 staff-page polish pass (Orders, Order Requests,
// Kitchen, Reservations, Customers, Events, Staff) — decisions D1-D9 in
// .claude/plan/v2/_research/polish-pass/00-PLAN.md. They guard the conventions
// the pass set, so a later edit cannot silently undo them: the shared page
// shell, the eyebrow + title header, error-only-without-data, filter-empty
// states, table -> cards at lg, the shared brand class constants, confirms for
// the money/irreversible actions, status words, and copy hygiene.
//
// Every pin is a PURE function (raw source -> problems[]). The group tests run
// each pin over the real file and expect no problems; the last test applies a
// named IN-MEMORY mutation to the real source for EVERY pin and expects at
// least one problem (source pins must be mutation-tested — nothing is ever
// written to disk). Needles are anchored on identifier boundaries (a rename
// like `!hasData` -> `!hasDataX` must not slip past a substring match), every
// negative carries a positive landmark, and any needle that could match THIS
// file is built by concatenation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// CRLF-normalised so no needle depends on the checkout's line endings.
const readSrc = (rel: string): string =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (raw: string): string => stripComments(raw);

const page = (seg: string): string => `apps/cafe/app/(dashboard)/${seg}/page.tsx`;
const cmp = (rel: string): string => `apps/cafe/components/${rel}`;

const ORDERS_PAGE = page("orders");
const REQUESTS_PAGE = page("requests");
const KITCHEN_PAGE = page("kitchen");
const RESERVATIONS_PAGE = page("reservations");
const CUSTOMERS_PAGE = page("customers");
const EVENTS_PAGE = page("events");
const STAFF_PAGE = page("staff");
const SHELL = cmp("menu/MenuPageShell.tsx");
const BRAND = cmp("brand/brand-classes.ts");
const ORDER_TABLE = cmp("orders/OrderTable.tsx");
const ORDER_FILTER_SELECT = cmp("orders/OrderFilterSelect.tsx");
const CANCEL_ORDER_DIALOG = cmp("orders/CancelOrderDialog.tsx");
const REQUESTS_BOARD = cmp("orders/RequestsBoard.tsx");
const ORDER_REQUEST_CARD = cmp("orders/OrderRequestCard.tsx");
const DEVICE_ALERT_DIALOG = cmp("orders/DeviceAlertSettingsDialog.tsx");
const KITCHEN_BODY = cmp("kitchen/KitchenBoardBody.tsx");
const KITCHEN_CHIP = cmp("kitchen/KitchenFreshnessChip.tsx");
const KITCHEN_LINE = cmp("kitchen/KitchenLineCard.tsx");
const KITCHEN_ORDER = cmp("kitchen/KitchenOrderCard.tsx");
const RESERVATIONS_TABLE = cmp("reservations/ReservationsTable.tsx");
const RESERVATION_CARD = cmp("reservations/ReservationRowCard.tsx");
const EVENTS_TABLE = cmp("events/EventsTable.tsx");
const EVENT_CARD = cmp("events/EventRowCard.tsx");
const CUSTOMER_STATUS = cmp("customers/CustomerListStatus.tsx");
const CUSTOMER_TABLE = cmp("customers/CustomerTable.tsx");
const CUSTOMER_CARD = cmp("customers/CustomerRowCard.tsx");
const RECEIVE_PAYMENT_DIALOG = cmp("customers/ReceivePaymentDialog.tsx");
const STAFF_STATUS = cmp("staff/StaffLoadStatus.tsx");
const STAFF_CARD = cmp("staff/StaffRowCard.tsx");

// ── Machinery ───────────────────────────────────────────────────────────────
type Pin = (raw: string) => string[];
interface Mutation {
  name: string;
  apply: (src: string) => string;
}
interface PinCase {
  file: string;
  pin: Pin;
  mutations: Mutation[];
}

const all =
  (...pins: Pin[]): Pin =>
  (raw) =>
    pins.flatMap((pin) => pin(raw));

function check(problems: string[], ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR = /[\w$]/;

/** A literal needle anchored on identifier boundaries wherever its ends are
 *  identifier characters — `!hasData` must not match inside `!hasDataX`. */
function idRe(text: string, flags = ""): RegExp {
  const head = WORD_CHAR.test(text.charAt(0)) ? "(?<![\\w$])" : "";
  const tail = WORD_CHAR.test(text.charAt(text.length - 1)) ? "(?![\\w$])" : "";
  return new RegExp(head + escapeRe(text) + tail, flags);
}

/** The `{ ... }` body that starts at the first `{` after `needle`, or null. */
function bodyAfter(src: string, needle: string): string | null {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const open = src.indexOf("{", at + needle.length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

function mutateStr(src: string, from: string, to: string, every: boolean): string {
  assert.ok(src.includes(from), `mutation needle not found in the real source: ${from}`);
  const out = every ? src.split(from).join(to) : src.replace(from, () => to);
  assert.notEqual(out, src, `mutation changed nothing: ${from}`);
  return out;
}

function mutateRe(src: string, re: RegExp, to: string | ((...groups: string[]) => string)): string {
  const out = typeof to === "string" ? src.replace(re, () => to) : src.replace(re, to);
  assert.notEqual(out, src, `mutation regex matched nothing: ${String(re)}`);
  return out;
}

const rep = (name: string, from: string, to: string): Mutation => ({
  name,
  apply: (src) => mutateStr(src, from, to, false),
});
const repEvery = (name: string, from: string, to: string): Mutation => ({
  name,
  apply: (src) => mutateStr(src, from, to, true),
});
const repRe = (name: string, re: RegExp, to: string | ((...groups: string[]) => string)): Mutation => ({
  name,
  apply: (src) => mutateRe(src, re, to),
});
const chain = (name: string, ...steps: Mutation[]): Mutation => ({
  name,
  apply: (src) => steps.reduce((acc, step) => step.apply(acc), src),
});

// ── D1: shell ───────────────────────────────────────────────────────────────
const SHELL_IMPORT_RE = /import\s*\{\s*MenuPageShell\s*\}\s*from\s*"@\/components\/menu\/MenuPageShell"/;
const SHELL_IMPORT_LINE = 'import { MenuPageShell } from "@/components/menu/MenuPageShell";';
const WRAP_RE = /<MenuPageShell>\s*<[A-Z]\w*\s*\/>\s*<\/MenuPageShell>/;
const WRAP_WIDE_RE = /<MenuPageShell wide>\s*<[A-Z]\w*\s*\/>\s*<\/MenuPageShell>/;
const ADMIN_GUARD_IMPORT_RE = /import\s*\{\s*AdminGuard\s*\}\s*from\s*"@\/components\/shared\/AdminGuard"/;

const pinPageShell =
  (wide: boolean): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    check(p, SHELL_IMPORT_RE.test(s), 'must import { MenuPageShell } from "@/components/menu/MenuPageShell"');
    const body = bodyAfter(s, "export default function");
    check(p, body !== null, "landmark: a default-exported page function must exist");
    if (body === null) return p;
    check(
      p,
      (wide ? WRAP_WIDE_RE : WRAP_RE).test(body),
      wide
        ? "the default export must render <MenuPageShell wide><Content /></MenuPageShell>"
        : "the default export must render <MenuPageShell><Content /></MenuPageShell> (no `wide` off Kitchen)",
    );
    return p;
  };

const pinStaffShell: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  check(p, SHELL_IMPORT_RE.test(s), "must import MenuPageShell");
  check(p, ADMIN_GUARD_IMPORT_RE.test(s), "landmark: must import AdminGuard");
  const body = bodyAfter(s, "export default function");
  check(p, body !== null, "landmark: a default-exported page function must exist");
  if (body === null) return p;
  const at = {
    "<AdminGuard>": body.indexOf("<AdminGuard>"),
    "<MenuPageShell>": body.indexOf("<MenuPageShell>"),
    "</MenuPageShell>": body.indexOf("</MenuPageShell>"),
    "</AdminGuard>": body.indexOf("</AdminGuard>"),
  };
  for (const [tag, idx] of Object.entries(at)) check(p, idx >= 0, `${tag} must exist in the default export`);
  if (Object.values(at).some((idx) => idx < 0)) return p;
  check(p, at["<AdminGuard>"] < at["<MenuPageShell>"], "open-tag order: <AdminGuard> must open BEFORE <MenuPageShell>");
  check(p, at["</MenuPageShell>"] < at["</AdminGuard>"], "close-tag order: </MenuPageShell> must close BEFORE </AdminGuard>");
  check(p, at["<MenuPageShell>"] < at["</MenuPageShell>"], "the shell must open before it closes");
  check(p, /<MenuPageShell>\s*<StaffManager\s*\/>\s*<\/MenuPageShell>/.test(body), "the shell must wrap <StaffManager />");
  return p;
};

const pinShellComponent: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  check(p, /export function MenuPageShell\(/.test(s), "landmark: MenuPageShell must be exported");
  check(p, /\{\s*children,\s*wide\s*=\s*false\s*\}/.test(s), "`wide = false` must be the default prop");
  check(p, /\bwide\?:\s*boolean/.test(s), "`wide?: boolean` must be in the props type");
  check(p, idRe('wide && "max-w-none"').test(s), '`wide && "max-w-none"` must lift the cap');
  return p;
};

const shellMutations = (wide: boolean): Mutation[] => {
  const open = wide ? "<MenuPageShell wide>" : "<MenuPageShell>";
  return [
    rep("rename the shell tag to MenuPageShells", open, open.replace("MenuPageShell", "MenuPageShells")),
    chain(
      "unwrap the shell (fragment instead)",
      rep("open", open, "<>"),
      rep("close", "</MenuPageShell>", "</>"),
    ),
    rep("drop the shell import", SHELL_IMPORT_LINE, ""),
    wide
      ? rep("remove `wide` (Kitchen back under the 1440px cap)", open, "<MenuPageShell>")
      : rep("pass `wide` on a non-Kitchen page", open, "<MenuPageShell wide>"),
  ];
};

const SHELL_PAGES: ReadonlyArray<readonly [string, boolean]> = [
  [ORDERS_PAGE, false],
  [REQUESTS_PAGE, false],
  [KITCHEN_PAGE, true],
  [RESERVATIONS_PAGE, false],
  [CUSTOMERS_PAGE, false],
  [EVENTS_PAGE, false],
];

const SHELL_CASES: PinCase[] = [
  ...SHELL_PAGES.map(([file, wide]): PinCase => ({ file, pin: pinPageShell(wide), mutations: shellMutations(wide) })),
  {
    file: STAFF_PAGE,
    pin: pinStaffShell,
    mutations: [
      repRe("shell OUTSIDE the guard (open tags swapped)", /<AdminGuard>(\s*)<MenuPageShell>/, (_m, ws) => `<MenuPageShell>${ws}<AdminGuard>`),
      repRe("close tags swapped (guard closes first)", /<\/MenuPageShell>(\s*)<\/AdminGuard>/, (_m, ws) => `</AdminGuard>${ws}</MenuPageShell>`),
      rep("rename the guard tag to AdminGuards", "<AdminGuard>", "<AdminGuards>"),
      chain("unwrap the shell (fragment instead)", rep("open", "<MenuPageShell>", "<>"), rep("close", "</MenuPageShell>", "</>")),
    ],
  },
  {
    file: SHELL,
    pin: pinShellComponent,
    mutations: [
      rep("default `wide = true`", "wide = false", "wide = true"),
      rep("drop the `wide && max-w-none` class", ', wide && "max-w-none"', ""),
      rep("rename the class condition to wider", 'wide && "max-w-none"', 'wider && "max-w-none"'),
      rep("rename the destructured prop", "children, wide = false", "children, wideX = false"),
    ],
  },
];

// ── D2: header ──────────────────────────────────────────────────────────────
const HEADER_HEAD_CHARS = 400;

const pinHeader =
  (eyebrow: string, title: string): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    check(p, (s.match(/<PageHeader(?![\w$])/g) ?? []).length === 1, "landmark: exactly one <PageHeader>");
    const at = s.search(/<PageHeader(?![\w$])/);
    if (at < 0) return p;
    const actions = s.indexOf("actions=", at);
    const head = s.slice(at, actions > at ? actions : at + HEADER_HEAD_CHARS);
    const gotEyebrow = /\beyebrow="([^"]*)"/.exec(head)?.[1];
    const gotTitle = /\btitle="([^"]*)"/.exec(head)?.[1];
    check(p, gotEyebrow === eyebrow, `eyebrow must be "${eyebrow}" (got ${JSON.stringify(gotEyebrow)})`);
    check(p, gotTitle === title, `title must be "${title}" (got ${JSON.stringify(gotTitle)})`);
    return p;
  };

const HEADER_SPECS: ReadonlyArray<readonly [string, string, string]> = [
  [ORDERS_PAGE, "Service", "Orders"],
  [REQUESTS_PAGE, "Service", "Order Requests"],
  [KITCHEN_PAGE, "Service", "Kitchen"],
  [RESERVATIONS_PAGE, "Service", "Reservations"],
  [CUSTOMERS_PAGE, "Manage", "Customers"],
  [EVENTS_PAGE, "Manage", "Events"],
  [STAFF_PAGE, "Admin", "Staff"],
];

const HEADER_CASES: PinCase[] = HEADER_SPECS.map(([file, eyebrow, title]) => ({
  file,
  pin: pinHeader(eyebrow, title),
  mutations: [
    rep("eyebrow renamed (plural)", `eyebrow="${eyebrow}"`, `eyebrow="${eyebrow}s"`),
    rep("title renamed (plural)", `title="${title}"`, `title="${title}s"`),
    rep("title case drift (lower-cased, like the old Order requests)", `title="${title}"`, `title="${title.toLowerCase()}"`),
  ],
}));

// ── D4: error state only without data ───────────────────────────────────────
const GUARD_GAP_MAX = 80;

/** `guard` (identifier-anchored) must be the condition that opens the branch
 *  rendering `anchor`: the last occurrence before it, with no element between. */
const pinGuardBefore =
  (anchor: string, guard: string): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    const at = s.indexOf(anchor);
    check(p, at >= 0, `landmark: ${anchor} must exist`);
    if (at < 0) return p;
    const before = s.slice(0, at);
    const re = idRe(guard, "g");
    let end = -1;
    for (let m = re.exec(before); m; m = re.exec(before)) end = m.index + m[0].length;
    check(p, end >= 0, `the guard \`${guard}\` must precede ${anchor}`);
    if (end >= 0) {
      const gap = before.slice(end);
      check(
        p,
        gap.length <= GUARD_GAP_MAX && !gap.includes("<"),
        `${anchor} must sit directly under \`${guard}\` (found ${JSON.stringify(gap.slice(0, GUARD_GAP_MAX))})`,
      );
    }
    return p;
  };

const pinErrorRetry: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  const elements: string[] = [];
  for (let at = s.indexOf("<ErrorState"); at >= 0; at = s.indexOf("<ErrorState", at + 1)) {
    const end = s.indexOf("/>", at);
    elements.push(s.slice(at, end < 0 ? s.length : end));
  }
  check(p, elements.length >= 1, "landmark: an <ErrorState> must be rendered");
  elements.forEach((el, i) => {
    check(p, /\bretryLabel="Try again"/.test(el), `ErrorState #${i + 1}: retryLabel="Try again"`);
    check(p, /\bonRetry=\{/.test(el), `ErrorState #${i + 1}: must pass an onRetry`);
    check(p, /\btitle="Couldn't load [^"]+"/.test(el), `ErrorState #${i + 1}: title must read "Couldn't load ..."`);
    check(
      p,
      /\bdescription="Check the internet connection, then try again\."/.test(el),
      `ErrorState #${i + 1}: the plain-English connection description`,
    );
  });
  return p;
};

const pinRegexes =
  (list: ReadonlyArray<readonly [RegExp, string]>): Pin =>
  (raw) => {
    const s = strip(raw);
    return list.filter(([re]) => !re.test(s)).map(([, message]) => message);
  };

/** The header renders in every branch: it must come before the error surface. */
const pinHeaderFirst =
  (anchor: string): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    const header = s.search(/<PageHeader(?![\w$])/);
    const surface = s.indexOf(anchor);
    check(p, header >= 0, "landmark: <PageHeader> must exist");
    check(p, surface >= 0, `landmark: ${anchor} must exist`);
    if (header >= 0 && surface >= 0) check(p, header < surface, `<PageHeader> must render before ${anchor} (header stays in the error branch)`);
    return p;
  };

const earlyReturn = (anchorJsx: string): Mutation =>
  repRe(
    `an early return renders ${anchorJsx} before the header`,
    /return \(\s*<>\s*<PageHeader/,
    `if (failed) { return ${anchorJsx}; }\n  return (<><PageHeader`,
  );

const RETRY_MUTATIONS: Mutation[] = [
  rep('rename "Try again" to "Retry"', 'retryLabel="Try again"', 'retryLabel="Retry"'),
  rep(
    "replace the connection description",
    'description="Check the internet connection, then try again."',
    'description="Something went wrong."',
  ),
  repRe("drop the onRetry prop", /\n\s*onRetry=\{[^\n]*\}/, ""),
];

const ERROR_CASES: PinCase[] = [
  {
    file: ORDERS_PAGE,
    pin: all(pinErrorRetry, pinGuardBefore("<ErrorState", "orders.isError && !orders.data"), pinHeaderFirst("<ErrorState")),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("drop the no-data half of the guard", "orders.isError && !orders.data", "orders.isError"),
      rep("rename `orders.data` in the guard (substring trap)", "!orders.data ?", "!orders.dataset ?"),
      earlyReturn("<ErrorState />"),
    ],
  },
  {
    file: REQUESTS_PAGE,
    pin: all(
      pinRegexes([
        [/\bconst loadFailed\s*=\s*requests\.isError\s*&&\s*requests\.data\s*===\s*undefined/, "loadFailed must be `requests.isError && requests.data === undefined`"],
        [/\bconst refreshFailed\s*=\s*requests\.isError\s*&&\s*requests\.data\s*!==\s*undefined/, "refreshFailed must be `requests.isError && requests.data !== undefined`"],
        [/\bisError=\{loadFailed\}/, "the board must receive isError={loadFailed} (never the raw query flag)"],
        [/\{refreshFailed\s*&&\s*\(\s*<p role="status"/, 'the refresh-failed notice must render under refreshFailed as <p role="status">'],
        [/\bonRetry=\{\(\) => void requests\.refetch\(\)\}/, "onRetry must refetch the requests query"],
      ]),
      pinHeaderFirst("<RequestsBoard"),
    ),
    mutations: [
      rep("drop the `=== undefined` half of loadFailed", "requests.isError && requests.data === undefined", "requests.isError"),
      rep("refreshFailed flips to no-data", "requests.data !== undefined", "requests.data === undefined"),
      rep("drop role=status from the notice", '<p role="status"', "<p"),
      rep("rename the notice condition (refreshFailedX)", "{refreshFailed && (", "{refreshFailedX && ("),
      rep("pass the raw flag to the board", "isError={loadFailed}", "isError={requests.isError}"),
      earlyReturn("<RequestsBoard />"),
    ],
  },
  {
    file: REQUESTS_BOARD,
    pin: all(pinErrorRetry, pinGuardBefore("<ErrorState", "if (isError)")),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("guard becomes always-on", "if (isError)", "if (true)"),
      rep("rename the guard flag", "if (isError)", "if (hadError)"),
    ],
  },
  {
    file: KITCHEN_PAGE,
    pin: all(
      pinRegexes([
        [/\bhasData=\{board\.data !== undefined\}/, "hasData must be derived from board.data !== undefined"],
        [/\bisError=\{board\.isError\}/, "the body must receive isError={board.isError}"],
        [/\bonRetry=\{\(\) => void board\.refetch\(\)\}/, "onRetry must refetch the board query"],
      ]),
      pinHeaderFirst("<KitchenBoardBody"),
    ),
    mutations: [
      rep("hasData hard-wired false", "hasData={board.data !== undefined}", "hasData={false}"),
      rep("isError hard-wired false", "isError={board.isError}", "isError={false}"),
      rep("retry stops refetching", "void board.refetch()", "void 0"),
      earlyReturn("<KitchenBoardBody />"),
    ],
  },
  {
    file: KITCHEN_BODY,
    pin: all(pinErrorRetry, pinGuardBefore("<ErrorState", "isError && !hasData")),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("drop `&& !hasData` (a failed poll wipes the board)", "isError && !hasData", "isError"),
      rep("rename `hasData` in the guard (substring trap)", "isError && !hasData", "isError && !hasDataX"),
    ],
  },
  {
    file: RESERVATIONS_PAGE,
    pin: all(
      pinErrorRetry,
      pinGuardBefore("<ErrorState", "reservations.isError && reservations.data === undefined"),
      pinHeaderFirst("<ErrorState"),
    ),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("drop the `=== undefined` guard", "reservations.isError && reservations.data === undefined", "reservations.isError"),
      rep("rename `undefined` in the guard (substring trap)", "reservations.data === undefined ?", "reservations.data === undefinedX ?"),
      earlyReturn("<ErrorState />"),
    ],
  },
  {
    file: CUSTOMER_STATUS,
    pin: all(
      pinErrorRetry,
      pinGuardBefore("<ErrorState", "if (refreshFailed)"),
      pinRegexes([[/\bif \(hasRows\) return null;/, "having rows must beat every status (`if (hasRows) return null;`)"]]),
    ),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("guard becomes always-on", "if (refreshFailed)", "if (true)"),
      rep("drop the hasRows early return", "if (hasRows) return null;", ""),
    ],
  },
  {
    file: CUSTOMERS_PAGE,
    pin: all(
      pinRegexes([[/\bonRetry=\{\(\) => void customers\.refetch\(\)\}/, "the status panel's onRetry must refetch the customers query"]]),
      pinHeaderFirst("<CustomerListStatus"),
    ),
    mutations: [rep("retry stops refetching", "void customers.refetch()", "void 0"), earlyReturn("<CustomerListStatus />")],
  },
  {
    file: EVENTS_PAGE,
    pin: all(pinErrorRetry, pinGuardBefore("<ErrorState", "events.isError && events.data === undefined"), pinHeaderFirst("<ErrorState")),
    mutations: [
      ...RETRY_MUTATIONS,
      rep("drop the `=== undefined` guard", "events.isError && events.data === undefined", "events.isError"),
      rep("rename `events.data` in the guard (substring trap)", "events.data === undefined ?", "events.dataset === undefined ?"),
      earlyReturn("<ErrorState />"),
    ],
  },
  {
    file: STAFF_STATUS,
    pin: all(pinErrorRetry, pinGuardBefore("<ErrorState", "if (isError)")),
    mutations: [...RETRY_MUTATIONS, rep("guard becomes always-on", "if (isError)", "if (true)")],
  },
  {
    file: STAFF_PAGE,
    pin: all(
      pinGuardBefore("<StaffLoadStatus", "staff.data === undefined"),
      pinRegexes([
        [/\bisError=\{staff\.isError\}/, "StaffLoadStatus must receive isError={staff.isError}"],
        [/\bonRetry=\{\(\) => void staff\.refetch\(\)\}/, "onRetry must refetch the staff query"],
      ]),
      pinHeaderFirst("<StaffLoadStatus"),
    ),
    mutations: [
      rep("render the status panel on isError instead of no-data", "staff.data === undefined ? (", "staff.isError ? ("),
      rep("always render the status panel", "staff.data === undefined ? (", "true ? ("),
      rep("retry stops refetching", "void staff.refetch()", "void 0"),
      earlyReturn("<StaffLoadStatus />"),
    ],
  },
];

// ── D4b: an offline (parked) query never reads as empty ─────────────────────
// TanStack v5 parks an offline query with isLoading AND isError false and no
// data, so without an explicit isPaused branch a page says "No orders yet".
const OFFLINE_COPY = "You appear to be offline";

interface OfflineSpec {
  /** The identifier-anchored condition that opens the offline branch. */
  guard: string;
  /** The empty-state branch head that must come AFTER the offline branch. */
  before: string;
  /** Anchor of the error branch, which must come BEFORE the offline branch. */
  after: string;
}

const pinOfflineBranch =
  (spec: OfflineSpec): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    const hit = idRe(spec.guard).exec(s);
    check(p, hit !== null, `the offline guard \`${spec.guard}\` must exist`);
    if (hit === null) return p;
    const rest = s.slice(hit.index + hit[0].length);
    const para = /<p\b([^>]*)>([^<]*)<\/p>/.exec(rest);
    check(
      p,
      para !== null && para.index <= GUARD_GAP_MAX && !rest.slice(0, para.index).includes("<"),
      "the offline guard must directly render a <p> status line",
    );
    if (para !== null) {
      check(p, /(?:^|\s)role="status"/.test(para[1]), 'the offline line must be role="status"');
      check(p, para[2].includes(OFFLINE_COPY), `the offline line must say "${OFFLINE_COPY}"`);
    }
    const empty = s.search(idRe(spec.before));
    check(p, empty >= 0, `landmark: the empty-state branch \`${spec.before}\` must exist`);
    if (empty >= 0) check(p, hit.index < empty, `the offline branch must come BEFORE \`${spec.before}\``);
    const error = s.indexOf(spec.after);
    check(p, error >= 0, `landmark: ${spec.after} must exist`);
    if (error >= 0) check(p, error < hit.index, `the offline branch must come AFTER ${spec.after}`);
    return p;
  };

const OFFLINE_COMMON: Mutation[] = [
  rep('drop role="status" from the offline line', 'role="status" ', ""),
  rep("reword the offline line", OFFLINE_COPY, "Loading"),
];

/** A page-level offline branch: `guard ? ( <p/> )` in a JSX ternary chain. */
const offlineTernaryCase = (file: string, obj: string, empty: string, dataGuard: string): PinCase => {
  const guard = `${obj}.isPaused && ${dataGuard}`;
  return {
    file,
    pin: pinOfflineBranch({ guard, before: empty, after: "<ErrorState" }),
    mutations: [
      ...OFFLINE_COMMON,
      rep("drop the data guard (bare isPaused would hide cached rows)", guard, `${obj}.isPaused`),
      rep(`rename isPaused (${obj}.isPausedX)`, `${obj}.isPaused`, `${obj}.isPausedX`),
      rep("an empty-state branch is tried first", `${guard} ? (`, `${empty} ? (<EmptyState />) : ${guard} ? (`),
    ],
  };
};

const OFFLINE_CASES: PinCase[] = [
  offlineTernaryCase(ORDERS_PAGE, "orders", "list.length === 0", "!orders.data"),
  offlineTernaryCase(RESERVATIONS_PAGE, "reservations", "list.length === 0 && isFiltered", "reservations.data === undefined"),
  offlineTernaryCase(EVENTS_PAGE, "events", "list.length === 0 && status !== ALL", "events.data === undefined"),
  {
    file: REQUESTS_PAGE,
    pin: pinRegexes([
      [
        /\bisOffline=\{requests\.isPaused && requests\.data === undefined\}/,
        "the board must receive isOffline={requests.isPaused && requests.data === undefined}",
      ],
    ]),
    mutations: [
      rep("drop the data guard (bare isPaused would hide cached rows)", "requests.isPaused && requests.data === undefined", "requests.isPaused"),
      rep("rename isPaused (requests.isPausedX)", "requests.isPaused", "requests.isPausedX"),
      rep("isOffline hard-wired false", "isOffline={requests.isPaused && requests.data === undefined}", "isOffline={false}"),
    ],
  },
  {
    file: REQUESTS_BOARD,
    pin: pinOfflineBranch({ guard: "if (isOffline)", before: "if (requests.length === 0)", after: "<ErrorState" }),
    mutations: [
      ...OFFLINE_COMMON,
      rep("the offline branch is always on", "if (isOffline)", "if (true)"),
      rep("rename the offline flag", "if (isOffline)", "if (isOfflineX)"),
      rep("an empty-state branch is tried first", "if (isOffline) {", "if (requests.length === 0) { return null; }\n  if (isOffline) {"),
    ],
  },
  {
    file: KITCHEN_PAGE,
    pin: pinRegexes([[/\bisPaused=\{board\.isPaused\}/, "the body must receive isPaused={board.isPaused}"]]),
    mutations: [
      rep("rename isPaused (board.isPausedX)", "isPaused={board.isPaused}", "isPaused={board.isPausedX}"),
      rep("isPaused hard-wired false", "isPaused={board.isPaused}", "isPaused={false}"),
    ],
  },
  {
    file: KITCHEN_BODY,
    pin: pinOfflineBranch({ guard: "if (isPaused && !hasData)", before: "if (cards.length === 0)", after: "<ErrorState" }),
    mutations: [
      ...OFFLINE_COMMON,
      rep("drop the data guard (bare isPaused would hide cached cards)", "if (isPaused && !hasData)", "if (isPaused)"),
      rep("rename isPaused in the guard", "if (isPaused && !hasData)", "if (isPausedX && !hasData)"),
      rep("an empty-state branch is tried first", "if (isPaused && !hasData) {", "if (cards.length === 0) { return null; }\n  if (isPaused && !hasData) {"),
    ],
  },
];

// ── D4: filter-empty states ─────────────────────────────────────────────────
const WINDOW_BEFORE_LABEL = 300;

interface FilterEmptySpec {
  titles: string[];
  label: string;
  handler: string;
  branch?: { cond: string; before: string };
}

const pinFilterEmpty =
  (spec: FilterEmptySpec): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    check(p, s.includes("<EmptyState"), "landmark: an <EmptyState> must exist");
    for (const title of spec.titles) check(p, s.includes(`"${title}"`), `the filter-empty title "${title}" must exist`);
    const hit = new RegExp(`>\\s*${escapeRe(spec.label)}\\s*<`).exec(s);
    check(p, hit !== null, `the way-back button "${spec.label}" must exist`);
    if (hit !== null) {
      const win = s.slice(Math.max(0, hit.index - WINDOW_BEFORE_LABEL), hit.index);
      check(p, idRe(spec.handler).test(win), `"${spec.label}" must be wired to \`${spec.handler}\``);
    }
    if (spec.branch) {
      const cond = s.search(idRe(spec.branch.cond));
      const plain = s.indexOf(spec.branch.before);
      check(p, cond >= 0, `the filtered branch \`${spec.branch.cond}\` must exist`);
      check(p, plain >= 0, `landmark: the no-data empty state ${spec.branch.before} must exist`);
      if (cond >= 0 && plain >= 0) check(p, cond < plain, "the filtered-empty branch must come BEFORE the no-data empty state");
    }
    return p;
  };

const FILTER_EMPTY_CASES: PinCase[] = [
  {
    file: ORDERS_PAGE,
    pin: pinFilterEmpty({ titles: ["No matching orders"], label: "Clear filters", handler: "onClick={clearFilters}" }),
    mutations: [
      rep('rename "Clear filters"', "Clear filters", "Reset"),
      repEvery("unwire the handler", "onClick={clearFilters}", "onClick={undefined}"),
      rep("drop the filtered title", 'filtersActive ? "No matching orders" : "No orders yet"', '"No orders yet"'),
    ],
  },
  {
    file: RESERVATIONS_PAGE,
    pin: pinFilterEmpty({
      titles: ["No reservations match"],
      label: "Clear filters",
      handler: "onClick={clearFilters}",
      branch: { cond: "list.length === 0 && isFiltered", before: 'title="No reservations"' },
    }),
    mutations: [
      rep('rename "Clear filters"', "Clear filters", "Reset"),
      rep("unwire the handler", "onClick={clearFilters}", "onClick={undefined}"),
      rep("rename the title", 'title="No reservations match"', 'title="No matches"'),
      rep("rename the branch condition (substring trap)", "list.length === 0 && isFiltered", "list.length === 0 && isFilteredX"),
    ],
  },
  {
    file: EVENTS_PAGE,
    pin: pinFilterEmpty({
      titles: ["No events match"],
      label: "Show all events",
      handler: "onClick={() => setStatusFilter(ALL)}",
      branch: { cond: "list.length === 0 && status !== ALL", before: 'title="No events"' },
    }),
    mutations: [
      rep('rename "Show all events"', "Show all events", "Show all"),
      rep("unwire the handler", "onClick={() => setStatusFilter(ALL)}", "onClick={() => undefined}"),
      rep("rename the title", 'title="No events match"', 'title="No matches"'),
      rep("rename the branch sentinel (substring trap)", "list.length === 0 && status !== ALL", "list.length === 0 && status !== ALLX"),
    ],
  },
  {
    file: CUSTOMER_STATUS,
    pin: pinFilterEmpty({ titles: ["No matches"], label: "Clear search", handler: "onClick={onClearSearch}" }),
    mutations: [
      rep('rename "Clear search"', "Clear search", "Reset"),
      rep("unwire the handler", "onClick={onClearSearch}", "onClick={onAdd}"),
    ],
  },
  {
    file: CUSTOMERS_PAGE,
    pin: pinRegexes([[/\bonClearSearch=\{\(\) => setSearch\(""\)\}/, 'the page must wire onClearSearch to setSearch("")']]),
    mutations: [rep("clear search does nothing", 'onClearSearch={() => setSearch("")}', "onClearSearch={() => undefined}")],
  },
];

// ── D5: table -> cards at its breakpoint (lg; xl for Orders and Events) ──────
type Breakpoint = "md" | "lg" | "xl";
const BREAKPOINTS: readonly Breakpoint[] = ["md", "lg", "xl"];

interface SwitchNeed {
  block: boolean;
  hidden: boolean;
}

/** Any block/hidden token of a breakpoint OTHER than the chosen one. */
const staleSwitchRe = (bp: Breakpoint): RegExp =>
  new RegExp(`(?<![\\w:-])(?:${BREAKPOINTS.filter((b) => b !== bp).join("|")}):(?:block|hidden)(?![\\w-])`);

const pinSwitch =
  (bp: Breakpoint, need: SwitchNeed): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    const literals = Array.from(s.matchAll(/"([^"\n]*)"/g), (m) => m[1].split(/\s+/).filter(Boolean));
    if (need.block) {
      check(p, literals.some((t) => t.includes("hidden") && t.includes(`${bp}:block`)), `a class string must carry \`hidden\` AND \`${bp}:block\` (the table)`);
    }
    if (need.hidden) {
      check(p, literals.some((t) => t.includes(`${bp}:hidden`)), `a class string must carry \`${bp}:hidden\` (the cards)`);
    }
    // Vision guard for the negative below: THIS file must carry its own switch.
    check(p, literals.some((t) => t.includes(`${bp}:block`) || t.includes(`${bp}:hidden`)), `landmark: the file must carry a ${bp}: switch token`);
    check(p, !staleSwitchRe(bp).test(s), `no block/hidden token of another breakpoint may remain (this file switches at ${bp})`);
    return p;
  };

const switchMutations = (bp: Breakpoint, need: SwitchNeed): Mutation[] => {
  const down: Breakpoint = bp === "xl" ? "lg" : "md";
  const moved = bp === "xl" ? "back to lg" : "to md";
  const ms: Mutation[] = [];
  const kinds: Array<readonly [string, boolean]> = [
    ["hidden", need.hidden],
    ["block", need.block],
  ];
  for (const [kind, wanted] of kinds) {
    if (!wanted) continue;
    ms.push(
      repEvery(`${bp} file switched ${moved} (${kind})`, `${bp}:${kind}`, `${down}:${kind}`),
      repEvery(`rename ${bp}:${kind} (${bp}:${kind}x)`, `${bp}:${kind}`, `${bp}:${kind}x`),
      rep(`keep ${bp}:${kind} but leave a stale ${down}:${kind}`, `${bp}:${kind}"`, `${bp}:${kind} ${down}:${kind}"`),
    );
    if (bp === "lg") ms.push(repEvery(`lg file switched to xl (${kind})`, `lg:${kind}`, `xl:${kind}`));
  }
  return ms;
};

const SWITCH_SPECS: ReadonlyArray<readonly [string, Breakpoint, SwitchNeed]> = [
  [ORDER_TABLE, "xl", { block: true, hidden: true }],
  [RESERVATIONS_PAGE, "lg", { block: false, hidden: true }],
  [RESERVATIONS_TABLE, "lg", { block: true, hidden: false }],
  [EVENTS_PAGE, "xl", { block: false, hidden: true }],
  [EVENTS_TABLE, "xl", { block: true, hidden: false }],
  [CUSTOMERS_PAGE, "lg", { block: true, hidden: true }],
  [STAFF_PAGE, "lg", { block: true, hidden: true }],
];

const SWITCH_CASES: PinCase[] = SWITCH_SPECS.map(([file, bp, need]) => ({
  file,
  pin: pinSwitch(bp, need),
  mutations: switchMutations(bp, need),
}));

// ── D3: shared brand constants ──────────────────────────────────────────────
const CLASS_TOKENS: ReadonlyArray<readonly [string, string[]]> = [
  ["BRAND_CONTROL_CLASS", ["h-10"]],
  ["BRAND_ROW_ACTION_CLASS", ["h-11", "w-11", "md:h-10", "md:w-10"]],
  ["BRAND_PANEL_CLASS", ["border-brand-rule", "bg-brand-slip"]],
  ["BRAND_TABLE_CONTAIN_CLASS", ["[contain:inline-size]"]],
];

const pinBrandClasses: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  for (const [name, tokens] of CLASS_TOKENS) {
    const m = new RegExp(`export const ${name}\\s*=\\s*"([^"]*)"`).exec(s);
    check(p, m !== null, `${name} must be exported as a plain string literal`);
    if (m === null) continue;
    const have = m[1].split(/\s+/);
    for (const token of tokens) check(p, have.includes(token), `${name} must contain the token \`${token}\` (has "${m[1]}")`);
  }
  return p;
};

const BRAND_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*"@\/components\/brand\/brand-classes"/;

const pinUsesConst =
  (name: string): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    const imp = BRAND_IMPORT_RE.exec(s);
    check(p, imp !== null && new RegExp(`\\b${name}\\b`).test(imp[1]), `must import ${name} from "@/components/brand/brand-classes"`);
    check(p, new RegExp(`className=\\{[^}]*\\b${name}\\b`).test(s), `${name} must be applied through a className`);
    return p;
  };

const pinRowActions: Pin = (raw) => {
  const p: string[] = pinUsesConst("BRAND_ROW_ACTION_CLASS")(raw);
  const s = strip(raw);
  const icons = count(s, 'size="icon"');
  const used = count(s, "className={BRAND_ROW_ACTION_CLASS}");
  check(p, icons >= 1, 'landmark: the file must have icon-only row actions (size="icon")');
  check(p, icons === used, `every size="icon" row action must use BRAND_ROW_ACTION_CLASS (icon buttons ${icons}, using it ${used})`);
  check(p, !/\bROW_ACTION_CLASS\b/.test(s), "no per-file ROW_ACTION_CLASS const (use the shared BRAND_ one)");
  return p;
};

const pinDeviceDialog: Pin = (raw) => {
  const p: string[] = pinUsesConst("BRAND_CONTROL_CLASS")(raw);
  check(p, !/\bsize="sm"/.test(strip(raw)), 'the Device settings button must not use size="sm" (h-8, under the 40px floor)');
  return p;
};

/** The table PANEL wrapper carries the containment: BRAND_TABLE_CONTAIN_CLASS
 *  sits in the same cn(...) call as BRAND_PANEL_CLASS, inside a className. */
const pinTableContain: Pin = (raw) => {
  const p: string[] = pinUsesConst("BRAND_TABLE_CONTAIN_CLASS")(raw);
  const s = strip(raw);
  const calls = Array.from(s.matchAll(/cn\(([^)]*)\)/g), (m) => m[1]);
  check(p, calls.some((args) => /\bBRAND_PANEL_CLASS\b/.test(args)), "landmark: the file has a cn(...) panel wrapper using BRAND_PANEL_CLASS");
  check(
    p,
    calls.some((args) => /\bBRAND_PANEL_CLASS\b/.test(args) && /\bBRAND_TABLE_CONTAIN_CLASS\b/.test(args)),
    "BRAND_TABLE_CONTAIN_CLASS must sit on the table panel wrapper (same cn() call as BRAND_PANEL_CLASS)",
  );
  return p;
};

/** Inline the literal back in place of every use after the import. */
const inlineConst = (name: string, literal: string): Mutation => ({
  name: `inline ${literal} in place of ${name}`,
  apply: (src) => {
    const imp = BRAND_IMPORT_RE.exec(src);
    assert.ok(imp, "brand-classes import must exist");
    const cut = imp.index + imp[0].length;
    return src.slice(0, cut) + mutateStr(src.slice(cut), name, literal, true);
  },
});

const constMutations = (name: string, literal: string): Mutation[] => [
  repEvery(`rename ${name} everywhere (${name}ES)`, name, `${name}ES`),
  inlineConst(name, literal),
];

const CONTROL_FILES = [
  ORDERS_PAGE,
  REQUESTS_PAGE,
  RESERVATIONS_PAGE,
  CUSTOMERS_PAGE,
  EVENTS_PAGE,
  STAFF_PAGE,
  CUSTOMER_STATUS,
  ORDER_FILTER_SELECT,
  CANCEL_ORDER_DIALOG,
  ORDER_REQUEST_CARD,
  RECEIVE_PAYMENT_DIALOG,
];
const PANEL_FILES = [
  ORDERS_PAGE,
  RESERVATIONS_PAGE,
  EVENTS_PAGE,
  CUSTOMERS_PAGE,
  STAFF_PAGE,
  ORDER_TABLE,
  ORDER_REQUEST_CARD,
  KITCHEN_ORDER,
  RESERVATIONS_TABLE,
  RESERVATION_CARD,
  EVENTS_TABLE,
  EVENT_CARD,
  CUSTOMER_TABLE,
  CUSTOMER_CARD,
  CUSTOMER_STATUS,
  STAFF_STATUS,
  STAFF_CARD,
];
const TABLE_CONTAIN_FILES = [ORDER_TABLE, RESERVATIONS_TABLE, EVENTS_TABLE, CUSTOMER_TABLE, STAFF_PAGE];
const ROW_ACTION_FILES = [
  ORDER_TABLE,
  RESERVATIONS_TABLE,
  RESERVATION_CARD,
  EVENTS_TABLE,
  EVENT_CARD,
  CUSTOMER_TABLE,
  CUSTOMER_CARD,
  STAFF_PAGE,
  STAFF_CARD,
];

const BRAND_CASES: PinCase[] = [
  {
    file: BRAND,
    pin: pinBrandClasses,
    mutations: [
      rep("control height h-10 -> h-9", '"h-10"', '"h-9"'),
      rep("row action md:w-10 renamed to md:w-100 (token trap)", "md:w-10", "md:w-100"),
      rep("row action drops its md:h-10", " md:h-10", ""),
      rep("panel drops bg-brand-slip", '"border-brand-rule bg-brand-slip"', '"border-brand-rule"'),
      rep("rename the BRAND_PANEL_CLASS export", "export const BRAND_PANEL_CLASS", "export const BRAND_PANELS_CLASS"),
      rep("contain token weakened", '"[contain:inline-size]"', '"[contain:size]"'),
      rep("rename the contain token (token trap)", '"[contain:inline-size]"', '"[contain:inline-sizes]"'),
      rep("rename the BRAND_TABLE_CONTAIN_CLASS export", "export const BRAND_TABLE_CONTAIN_CLASS", "export const BRAND_TABLE_CONTAINS_CLASS"),
    ],
  },
  ...CONTROL_FILES.map((file): PinCase => ({
    file,
    pin: pinUsesConst("BRAND_CONTROL_CLASS"),
    mutations: constMutations("BRAND_CONTROL_CLASS", '"h-9"'),
  })),
  {
    file: DEVICE_ALERT_DIALOG,
    pin: pinDeviceDialog,
    mutations: [
      ...constMutations("BRAND_CONTROL_CLASS", '"h-9"'),
      rep('size="sm" creeps back', 'variant="outline" className={BRAND_CONTROL_CLASS}', 'variant="outline" size="sm" className={BRAND_CONTROL_CLASS}'),
    ],
  },
  ...PANEL_FILES.map((file): PinCase => ({
    file,
    pin: pinUsesConst("BRAND_PANEL_CLASS"),
    mutations: constMutations("BRAND_PANEL_CLASS", '"border"'),
  })),
  ...ROW_ACTION_FILES.map((file): PinCase => ({
    file,
    pin: pinRowActions,
    mutations: [
      ...constMutations("BRAND_ROW_ACTION_CLASS", '"h-8 w-8"'),
      rep("one icon button reverts to a literal size", "className={BRAND_ROW_ACTION_CLASS}", 'className="h-8 w-8"'),
      { name: "a local ROW_ACTION_CLASS const appears", apply: (src) => `${src}\nconst ROW_ACTION_CLASS = "h-8 w-8";\n` },
    ],
  })),
  ...TABLE_CONTAIN_FILES.map((file): PinCase => ({
    file,
    pin: pinTableContain,
    mutations: [
      ...constMutations("BRAND_TABLE_CONTAIN_CLASS", '"[contain:inline-size]"'),
      rep("drop it from the panel wrapper (import left behind)", ", BRAND_TABLE_CONTAIN_CLASS)", ")"),
      chain(
        "move it from the panel wrapper onto the <Table> element",
        rep("drop from wrapper", ", BRAND_TABLE_CONTAIN_CLASS)", ")"),
        rep("put on Table", "<Table>", "<Table className={BRAND_TABLE_CONTAIN_CLASS}>"),
      ),
    ],
  })),
];

// ── D6: confirms ────────────────────────────────────────────────────────────
/** The JSX element (opening tag up to its `/>`) that contains `marker`. */
function elementAround(s: string, tag: string, marker: string): string | null {
  const at = s.indexOf(marker);
  if (at < 0) return null;
  const start = s.lastIndexOf(tag, at);
  const end = s.indexOf("/>", at);
  return start < 0 || end < 0 ? null : s.slice(start, end);
}

const pinReservationConfirm: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  const dialog = elementAround(s, "<ConfirmDialog", 'confirmLabel="Cancel reservation"');
  check(p, dialog !== null, 'landmark: a <ConfirmDialog confirmLabel="Cancel reservation"> must exist');
  if (dialog !== null) check(p, /\bonConfirm=\{confirmCancel\}/.test(dialog), "the Cancel reservation dialog must confirm through confirmCancel");
  const body = bodyAfter(s, "const confirmCancel = async () =>");
  check(p, body !== null, "landmark: confirmCancel must exist");
  check(
    p,
    body !== null && /updateReservation\.mutateAsync\(\{[^}]*status:\s*"Cancelled"/.test(body),
    "confirmCancel must be the one caller of the Cancelled status write",
  );
  check(p, count(s, 'status: "Cancelled"') === 1, 'the Cancelled status write must appear exactly once (inside confirmCancel)');
  check(p, !/setStatus\([^)]*"Cancelled"/.test(s), "no row button may write Cancelled directly through setStatus");
  check(p, count(s, "onCancel={setCancelling}") === 2, "the table AND the card must open the dialog (onCancel={setCancelling} x2)");
  check(p, count(s, 'onSeat={(row) => setStatus(row, "Seated")}') === 2, "Seat stays a one-tap action on both table and cards");
  check(p, count(s, 'onComplete={(row) => setStatus(row, "Completed")}') === 2, "Complete stays a one-tap action on both table and cards");
  return p;
};

const pinEventConfirm: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  const dialog = elementAround(s, "<ConfirmDialog", "open={pendingOpen}");
  check(p, dialog !== null, "landmark: the pending-action <ConfirmDialog open={pendingOpen}> must exist");
  if (dialog !== null) check(p, /\bonConfirm=\{confirmPending\}/.test(dialog), "the pending dialog must confirm through confirmPending");
  const body = bodyAfter(s, "const confirmPending = async () =>");
  check(p, body !== null, "landmark: confirmPending must exist");
  check(p, body !== null && body.includes("updateEvent.mutateAsync"), "confirmPending must be the mutation caller");
  check(p, body !== null && /advance:\s*e\.payable/.test(body), "Receive balance writes must live inside confirmPending");
  check(p, body !== null && /status:\s*"Cancelled"/.test(body), "Cancel event writes must live inside confirmPending");
  check(p, count(s, "advance: e.payable") === 1, "the balance write must appear exactly once");
  check(p, count(s, 'status: "Cancelled"') === 1, "the Cancelled status write must appear exactly once");
  check(p, count(s, 'onReceiveBalance={(row) => ask("receive", row)}') === 2, "Receive balance must ask first on table AND cards");
  check(p, count(s, 'onCancel={(row) => ask("cancel", row)}') === 2, "Cancel event must ask first on table AND cards");
  check(p, count(s, 'onComplete={(row) => setStatus(row, "Completed")}') === 2, "Complete stays a one-tap action on both table and cards");
  check(p, /confirmLabel:\s*"Receive balance"/.test(s), 'the confirm button must read "Receive balance"');
  check(p, /confirmLabel:\s*"Cancel event"/.test(s), 'the confirm button must read "Cancel event"');
  return p;
};

/** Row components only raise intents; they never own the mutation. */
const pinRowsDoNotMutate =
  (landmark: RegExp): Pin =>
  (raw) => {
    const p: string[] = [];
    const s = strip(raw);
    check(p, landmark.test(s), `landmark: ${String(landmark)} must exist (the row raises its intents)`);
    check(p, !/from\s*"@\/hooks\/use-(?:events|reservations)"/.test(s), "a row component must not import the events/reservations mutation hooks");
    check(p, !/\.mutate(?:Async)?\(/.test(s), "a row component must not call a mutation");
    return p;
  };

const ROW_INTENT_SPECS: ReadonlyArray<readonly [string, RegExp, string, string]> = [
  [RESERVATIONS_TABLE, /\bonCancel\(r\)/, "use-reservations", "useUpdateReservation"],
  [RESERVATION_CARD, /\bonCancel\(r\)/, "use-reservations", "useUpdateReservation"],
  [EVENTS_TABLE, /\bonCancel\(e\)/, "use-events", "useUpdateEvent"],
  [EVENT_CARD, /\bonCancel\(e\)/, "use-events", "useUpdateEvent"],
];

const CONFIRM_CASES: PinCase[] = [
  {
    file: RESERVATIONS_PAGE,
    pin: pinReservationConfirm,
    mutations: [
      repEvery("Cancel button calls the mutation directly", "onCancel={setCancelling}", 'onCancel={(row) => setStatus(row, "Cancelled")}'),
      rep("the dialog no longer confirms through confirmCancel", "onConfirm={confirmCancel}", "onConfirm={confirmDelete}"),
      rep("the confirm path writes a different status", 'data: { status: "Cancelled" }', 'data: { status: "Completed" }'),
      repEvery("Seat suddenly asks first", 'onSeat={(row) => setStatus(row, "Seated")}', "onSeat={setCancelling}"),
      repEvery("Complete suddenly asks first", 'onComplete={(row) => setStatus(row, "Completed")}', "onComplete={setCancelling}"),
    ],
  },
  {
    file: EVENTS_PAGE,
    pin: pinEventConfirm,
    mutations: [
      repEvery("Cancel event button calls the mutation directly", 'onCancel={(row) => ask("cancel", row)}', 'onCancel={(row) => setStatus(row, "Cancelled")}'),
      repEvery(
        "Receive balance button calls the mutation directly",
        'onReceiveBalance={(row) => ask("receive", row)}',
        "onReceiveBalance={(row) => updateEvent.mutate({ id: row._id, data: { advance: row.payable } })}",
      ),
      rep("the dialog no longer confirms through confirmPending", "onConfirm={confirmPending}", "onConfirm={confirmDelete}"),
      rep("the confirm path stops cancelling", '{ status: "Cancelled" }', '{ status: "Booked" }'),
      rep('rename the confirm label to "Receive"', 'confirmLabel: "Receive balance"', 'confirmLabel: "Receive"'),
      repEvery("Complete suddenly asks first", 'onComplete={(row) => setStatus(row, "Completed")}', 'onComplete={(row) => ask("cancel", row)}'),
    ],
  },
  ...ROW_INTENT_SPECS.map(
    ([file, landmark, hook, symbol]): PinCase => ({
      file,
      pin: pinRowsDoNotMutate(landmark),
      mutations: [
        { name: `the row imports ${symbol}`, apply: (src) => `import { ${symbol} } from "@/hooks/${hook}";\n${src}` },
        { name: "the row calls a mutation", apply: (src) => `${src}\nconst probe = { mutate: (x: number) => x };\nprobe.mutate(1);\n` },
      ],
    }),
  ),
];

// ── D7: status words ────────────────────────────────────────────────────────
const STATUS_WORD_CASES: PinCase[] = [
  {
    file: EVENT_CARD,
    pin: pinRegexes([
      [/>\s*Due\s+\{inr\(balance\)\}\s*<\/Badge>/, 'the Events card due amount must carry the word "Due"'],
      [/>\s*Total\s+\{inr\(e\.payable\)\}\s*<\/span>/, 'the Events card amount must carry the word "Total"'],
    ]),
    mutations: [
      rep('drop the word "Due"', "Due {inr(balance)}", "{inr(balance)}"),
      rep('rename "Due" to "Owes"', "Due {inr(balance)}", "Owes {inr(balance)}"),
      rep('drop the word "Total"', "Total {inr(e.payable)}", "{inr(e.payable)}"),
    ],
  },
  {
    file: EVENTS_TABLE,
    pin: all(
      pinRegexes([
        [/>\s*Due\s+\{inr\(balance\)\}\s*<\/Badge>/, 'the Events table due amount must carry the word "Due"'],
        [/<TableHead\b[^>]*>\s*Total\s*<\/TableHead>/, 'the Events table amount column must be headed "Total"'],
      ]),
      (raw) => {
        const s = strip(raw);
        const headed = /<TableHead\b[^>]*>\s*Total\s*<\/TableHead>/.test(s);
        return headed && /<TableHead\b[^>]*>\s*Payable\s*<\/TableHead>/.test(s) ? ['no "Payable" column header may remain beside "Total"'] : [];
      },
    ),
    mutations: [
      rep('drop the word "Due"', "Due {inr(balance)}", "{inr(balance)}"),
      rep('rename "Due" to "Owes"', "Due {inr(balance)}", "Owes {inr(balance)}"),
      rep('rename the column back to "Payable"', ">Total</TableHead>", ">Payable</TableHead>"),
      rep('a second "Payable" header appears', ">Total</TableHead>", ">Total</TableHead><TableHead>Payable</TableHead>"),
    ],
  },
  {
    file: CUSTOMER_CARD,
    pin: pinRegexes([[/>\s*Due\s+\{inr\(customer\.totalDue\)\}\s*<\/Badge>/, 'the Customers card due amount must carry the word "Due"']]),
    mutations: [
      rep('drop the word "Due"', "Due {inr(customer.totalDue)}", "{inr(customer.totalDue)}"),
      rep('rename "Due" to "Owes"', "Due {inr(customer.totalDue)}", "Owes {inr(customer.totalDue)}"),
    ],
  },
  {
    file: CUSTOMER_TABLE,
    pin: pinRegexes([[/<TableHead[^>]*>\s*Due\s*<\/TableHead>/, 'the Customers table due column must be headed "Due"']]),
    mutations: [rep('rename the column to "Owed"', ">Due</TableHead>", ">Owed</TableHead>")],
  },
];

// ── Kitchen ─────────────────────────────────────────────────────────────────
const pinFreshnessChip: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  check(p, /Updated\s*\{ageSec\}s ago/.test(s), "landmark: the chip still renders its `Updated {ageSec}s ago` label");
  const guard = /if\s*\(\s*dataUpdatedAt\s*===\s*0\s*\)\s*/.exec(s);
  check(p, guard !== null, "the chip must guard dataUpdatedAt === 0");
  const age = s.indexOf("const ageMs");
  check(p, age >= 0, "landmark: the age computation must exist");
  if (guard === null) return p;
  if (age >= 0) check(p, guard.index < age, "the zero guard must run BEFORE the age is computed");
  const body = bodyAfter(s.slice(guard.index), guard[0]);
  check(p, body !== null, "the zero guard must be a block");
  if (body === null) return p;
  const span = /<span\b([^>]*)>/.exec(body);
  check(p, span !== null, "landmark: the guard returns a placeholder <span> (keeps the header from shifting)");
  check(p, !/\breturn\s+null\b/.test(body), "the guard must not return null (the header would grow when the first load lands)");
  if (span !== null) {
    check(p, /(?:^|\s)aria-hidden(?=\s|$|=\{true\}|="true")/.test(span[1]), "the placeholder must be aria-hidden");
    const tokens = (/\bclassName="([^"]*)"/.exec(span[1])?.[1] ?? "").split(/\s+/);
    check(p, tokens.includes("invisible"), "the placeholder must carry the `invisible` class token");
  }
  return p;
};

const pinKitchenSummary: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  const data = /\{board\.data !== undefined\s*\?\s*\(/.exec(s);
  check(p, data !== null, "landmark: the summary ternary must start with a board.data !== undefined branch");
  const loading = /:\s*board\.isLoading\s*\?\s*\(\s*<div\b[^>]*>\s*Loading orders[^<]*<\/div>/.exec(s);
  check(p, loading !== null, 'the summary must hold its place with a board.isLoading branch rendering "Loading orders"');
  if (data !== null && loading !== null) check(p, data.index < loading.index, "the loaded branch must come before the loading branch");
  return p;
};

const pinLineLabel: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  check(p, /<Checkbox\b/.test(s), "landmark: the line checkbox must exist");
  const m = /<label\b([^>]*)>\s*<Checkbox\b[\s\S]*?\/>\s*<\/label>/.exec(s);
  check(p, m !== null, "the line checkbox must sit inside a <label> hit area");
  if (m !== null) {
    const tokens = (/\bclassName="([^"]*)"/.exec(m[1])?.[1] ?? "").split(/\s+/);
    check(p, tokens.includes("min-h-10") && tokens.includes("min-w-10"), "the label must be at least 40px (min-h-10 min-w-10)");
    check(p, /\bonCheckedChange=/.test(m[0]), "the checkbox inside the label must keep its onCheckedChange");
  }
  return p;
};

const CHIP_GUARD_RE = /  if \(dataUpdatedAt === 0\) \{[\s\S]*?\n  \}\n/;
const CHIP_GUARD_BLOCK =
  '  if (dataUpdatedAt === 0) {\n    return <span aria-hidden className="invisible text-sm">Updated 0s ago</span>;\n  }\n';

const KITCHEN_CASES: PinCase[] = [
  {
    file: KITCHEN_CHIP,
    pin: pinFreshnessChip,
    mutations: [
      rep("placeholder drops the `invisible` class", 'className="invisible text-sm"', 'className="text-sm"'),
      rep("rename the `invisible` token (token trap)", 'className="invisible text-sm"', 'className="invisibles text-sm"'),
      rep("placeholder drops aria-hidden", '<span aria-hidden className="invisible', '<span className="invisible'),
      rep("placeholder sets aria-hidden to false", '<span aria-hidden className="invisible', '<span aria-hidden="false" className="invisible'),
      repRe("guard removed", CHIP_GUARD_RE, ""),
      rep("guard compares against 1 instead of 0", "dataUpdatedAt === 0", "dataUpdatedAt === 1"),
      rep("rename the guarded variable", "dataUpdatedAt === 0", "dataUpdated === 0"),
      chain(
        "guard moved after the age computation",
        repRe("remove", CHIP_GUARD_RE, ""),
        rep("reinsert", "const ageMs = now - dataUpdatedAt;", `const ageMs = now - dataUpdatedAt;\n${CHIP_GUARD_BLOCK}`),
      ),
      repRe("guard goes back to returning null", /return \(\s*<span aria-hidden[\s\S]*?<\/span>\s*\);/, "return null;"),
    ],
  },
  {
    file: KITCHEN_PAGE,
    pin: pinKitchenSummary,
    mutations: [
      repRe("loading branch removed", /\) : board\.isLoading \? \(\s*<div[^>]*>Loading orders[^<]*<\/div>\s*\) : null\}/, ") : null}"),
      rep("rename the loading flag", ") : board.isLoading ? (", ") : board.isFetching ? ("),
      rep("loading text renamed", "Loading orders", "Please wait"),
      rep("loaded branch loses its data check", "{board.data !== undefined ? (", "{board.isSuccess ? ("),
    ],
  },
  {
    file: KITCHEN_LINE,
    pin: pinLineLabel,
    mutations: [
      chain("label becomes a div", repEvery("open", "<label", "<div"), repEvery("close", "</label>", "</div>")),
      rep("the checkbox leaves the label", "<Checkbox", "</label><Checkbox"),
      rep("label shrinks below 40px", "min-h-10", "min-h-5"),
      rep("rename the min width token (token trap)", "min-w-10", "min-w-100"),
    ],
  },
];

// ── Copy hygiene ────────────────────────────────────────────────────────────
const HINGLISH = ["hai", "hain", "karo", "nahi", "haan", "hoga", "chalao", "batao", "hatao", "pakka", "kholo", "dobara", "yahan", "banao"];
const HINGLISH_RE = new RegExp(`\\b(?:${HINGLISH.join("|")})\\b`, "i");
const CAFE_NAME = "Luci" + "fer";
const CAFE_NAME_RE = new RegExp(CAFE_NAME, "i");
const MIN_STRIPPED_CHARS = 200;

const pinCopyHygiene: Pin = (raw) => {
  const p: string[] = [];
  const s = strip(raw);
  check(p, s.length > MIN_STRIPPED_CHARS && /\bexport\b/.test(s), "landmark: the file must have real, exporting code after stripComments");
  const hinglish = HINGLISH_RE.exec(s);
  check(p, hinglish === null, `Hinglish word in code/copy: ${JSON.stringify(hinglish && s.slice(Math.max(0, hinglish.index - 20), hinglish.index + 30))}`);
  check(p, !CAFE_NAME_RE.test(s), "a hardcoded cafe name must not appear in v2 code");
  return p;
};

const COPY_FILES = [
  ORDERS_PAGE,
  REQUESTS_PAGE,
  KITCHEN_PAGE,
  RESERVATIONS_PAGE,
  CUSTOMERS_PAGE,
  EVENTS_PAGE,
  STAFF_PAGE,
  SHELL,
  BRAND,
  ORDER_TABLE,
  ORDER_FILTER_SELECT,
  CANCEL_ORDER_DIALOG,
  REQUESTS_BOARD,
  ORDER_REQUEST_CARD,
  DEVICE_ALERT_DIALOG,
  KITCHEN_BODY,
  KITCHEN_CHIP,
  KITCHEN_LINE,
  KITCHEN_ORDER,
  RESERVATIONS_TABLE,
  RESERVATION_CARD,
  EVENTS_TABLE,
  EVENT_CARD,
  CUSTOMER_STATUS,
  CUSTOMER_TABLE,
  CUSTOMER_CARD,
  STAFF_STATUS,
  STAFF_CARD,
];

const COPY_MUTATIONS: Mutation[] = [
  ...HINGLISH.map(
    (word): Mutation => ({
      name: `Hinglish "${word}" (upper-cased) in a string literal`,
      apply: (src) => `${src}\nexport const copyProbe = "so ${word.toUpperCase()} now";\n`,
    }),
  ),
  { name: "Hinglish in JSX text", apply: (src) => `${src}\nexport const copyJsx = <p>Yeh ${HINGLISH[0]} sahi</p>;\n` },
  { name: "the cafe name in a string literal", apply: (src) => `${src}\nexport const cafeProbe = "Welcome to ${CAFE_NAME}";\n` },
];

const COPY_CASES: PinCase[] = COPY_FILES.map((file) => ({ file, pin: pinCopyHygiene, mutations: COPY_MUTATIONS }));

// ── Suite ───────────────────────────────────────────────────────────────────
interface Group {
  title: string;
  cases: PinCase[];
  extra?: () => void;
}

const GROUPS: Group[] = [
  {
    title: "PIN D1: every page renders inside MenuPageShell (Kitchen wide, Staff guard outside) and the shell takes `wide`",
    cases: SHELL_CASES,
  },
  { title: "PIN D2: PageHeader carries the sidebar-group eyebrow and the sidebar-row title", cases: HEADER_CASES },
  {
    title: "PIN D4: the full error screen shows only with no data (Try again + retry), and the header stays put",
    cases: ERROR_CASES,
  },
  { title: "PIN D4b: an offline (parked) query never reads as empty", cases: OFFLINE_CASES },
  {
    title: "PIN D4: a filter or search that matches nothing has its own empty state with a way back",
    cases: FILTER_EMPTY_CASES,
  },
  { title: "PIN D5: tables become cards at their breakpoint (xl for Orders and Events, lg for the rest), no stale switch", cases: SWITCH_CASES },
  { title: "PIN D3: the shared brand constants are defined and used where the plan says", cases: BRAND_CASES },
  {
    title: "PIN D6: Cancel reservation, Cancel event and Receive balance run from the ConfirmDialog, never the row button",
    cases: CONFIRM_CASES,
  },
  { title: "PIN D7: due and total amounts carry their words", cases: STATUS_WORD_CASES },
  {
    title: "PIN kitchen: the chip keeps its place at dataUpdatedAt 0, the summary holds while loading, the line checkbox sits in a label",
    cases: KITCHEN_CASES,
  },
  {
    title: "PIN copy hygiene: no Hinglish and no cafe name in any polished file",
    cases: COPY_CASES,
    extra: () => {
      const src = readSrc(ORDERS_PAGE);
      assert.deepEqual(
        pinCopyHygiene(`${src}\n// yahan ${HINGLISH[0]} ${CAFE_NAME}\n/* ${HINGLISH[1]} */\n`),
        [],
        "comment-only mentions are out of scope (the scan reads code after stripComments)",
      );
    },
  },
];

for (const group of GROUPS) {
  test(group.title, () => {
    assert.ok(group.cases.length > 0, "landmark: the group must pin at least one file");
    for (const c of group.cases) {
      const src = readSrc(c.file);
      assert.ok(src.length > 0, `${c.file} must be readable`);
      const problems = c.pin(src);
      assert.deepEqual(problems, [], `${c.file}\n  - ${problems.join("\n  - ")}`);
    }
    group.extra?.();
  });
}

test("MUTATION self-check: every pin reports a problem for each named in-memory mutation", () => {
  let applied = 0;
  for (const group of GROUPS) {
    for (const c of group.cases) {
      assert.ok(c.mutations.length > 0, `${c.file}: every pin case needs at least one mutation`);
      const real = readSrc(c.file);
      assert.deepEqual(c.pin(real), [], `${c.file}: the unmutated source must be clean before it is mutated`);
      for (const m of c.mutations) {
        const mutated = m.apply(real);
        assert.notEqual(mutated, real, `${c.file} :: ${m.name}: the mutation changed nothing`);
        const problems = c.pin(mutated);
        assert.ok(problems.length >= 1, `${c.file} :: ${m.name}: the pin did NOT notice this mutation`);
        applied++;
      }
    }
  }
  assert.ok(applied >= GROUPS.length, "landmark: mutations were actually applied");
});
