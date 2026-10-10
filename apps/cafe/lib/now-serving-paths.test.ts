import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Print customization S9 (phase 2) — source pins for the Now Serving screen: the page inside the dashboard shell, the
// public payload (numbers and times only), the client bundle boundary, the pure announcer, the safe-storage prefs, the
// sound hook's browser discipline, the inbound links, the CSS that keeps a TV board inside its column, the sound card
// and the hygiene gates. Pins read COMMENT-STRIPPED source (behaviour, not prose) except the banned-needle scans, which
// read raw bytes. The announcer / prefs behaviour itself is tested in now-serving-announcer.test.ts / -prefs.test.ts.
// Banned needles are built by concatenation so this file never contains them as one literal.

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SHARED_CONSTANTS = path.join(CAFE_ROOT, "..", "..", "packages", "shared", "src", "constants.ts");
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const read = (rel: string): string => stripComments(raw(rel));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const PAGE = "app/(dashboard)/now-serving/page.tsx";
const ANNOUNCER = "lib/now-serving-announcer.ts";
const PREFS = "lib/now-serving-prefs.ts";
const HOOK = "hooks/use-now-serving-sound.ts";
const BOARD = "components/now-serving/NowServingBoard.tsx";
const COLUMN = "components/now-serving/NowServingColumn.tsx";
const PANEL = "components/now-serving/SoundPanel.tsx";
const LINK = "components/now-serving/NowServingLink.tsx";
const SIDEBAR = "components/layout/AppSidebar.tsx";
const KITCHEN_PAGE = "app/(dashboard)/kitchen/page.tsx";
const TOKENS_PAGE = "app/(dashboard)/settings/tokens/page.tsx";

const COMPONENTS = [BOARD, COLUMN, PANEL, LINK];
const SCREEN_FILES = [...COMPONENTS, PAGE];
const S9_FILES = [ANNOUNCER, PREFS, HOOK, ...SCREEN_FILES];
const FILE_LINE_MAX = 300;

/** Every module specifier a file imports (`from "x"`), in order. */
const specifiersOf = (src: string): string[] => Array.from(src.matchAll(/\bfrom\s+"([^"]+)"/g), (m) => m[1]);

// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("page: one background token board, the realtime nudge and the wake lock - and it never writes a token", () => {
  const src = read(PAGE);
  assert.equal(count(src, "useTokenBoard({ enabled: true, background: true })"), 1);
  assert.equal(count(src, "useTokenRealtime()"), 1);
  assert.equal(count(src, "useWakeLock(true)"), 1);
  // Negatives, guarded by the positive landmarks above (the page really calls hooks).
  for (const banned of ["useTokenAction" + "(", "useMutation" + "(", "apiSend" + "("]) {
    assert.ok(!src.includes(banned), `the Now Serving page only reads: no ${banned}`);
  }
});

test("page: lives inside the dashboard shell like Kitchen (MenuPageShell wide), with no app/(display) route group", () => {
  assert.ok(existsSync(path.join(CAFE_ROOT, "app", "(dashboard)")), "landmark: the dashboard group exists");
  assert.ok(existsSync(path.join(CAFE_ROOT, PAGE)), "the page is under app/(dashboard)/");
  assert.ok(PAGE.startsWith("app/(dashboard)/"));
  assert.ok(!existsSync(path.join(CAFE_ROOT, "app", "(display)")), "no (display) group: the exit is the shell's sidebar / top bar");
  assert.equal(count(read(PAGE), "<MenuPageShell wide>"), 1);
});

test("page: the sound settings open ONLY from the settings button (owner s83) and only while tokens are on", () => {
  const src = read(PAGE);
  assert.ok(src.includes("const tokensOn = q.data?.enabled !== false;"));
  // Nothing opens by itself: the pop-up starts closed and the settings button is the only thing that opens it.
  assert.equal(count(src, "const [settingsOpen, setSettingsOpen] = useState(false);"), 1);
  assert.equal(count(src, "setSettingsOpen(true)"), 1);
  assert.ok(src.includes("onClick={() => setSettingsOpen(true)}"), "the one opener is the button click");
  assert.ok(!src.includes('panel === "auto"') && !src.includes("panelShown"), "no auto-open while sound is off");
  assert.ok(src.includes("<Settings aria-hidden />"), "a settings (gear) button");
  assert.ok(src.includes('aria-haspopup="dialog"'));
  assert.equal(count(src, "{tokensOn && (\n        <SoundPanel"), 1, "the pop-up exists only while tokens are on");
  assert.ok(src.includes("open={settingsOpen}") && src.includes("onOpenChange={setSettingsOpen}"));
  assert.equal(count(src, "<SoundPanel"), 1);
  assert.ok(src.includes("<KitchenFreshnessChip dataUpdatedAt={q.dataUpdatedAt} />"), "freshness is the Kitchen chip");
});

test("use-tokens: the board still polls on the Kitchen interval and keeps polling in a background tab when asked", () => {
  const src = read("hooks/use-tokens.ts");
  assert.ok(src.includes("refetchInterval: enabled ? REFETCH_INTERVALS.KITCHEN : false"));
  assert.ok(src.includes("refetchIntervalInBackground: background"));
});

// ── The payload: numbers and times only ────────────────────────────────────────────────────────────────────────────

function interfaceKeys(src: string, name: string): string[] {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  assert.ok(m, `landmark: interface ${name} exists`);
  return Array.from(m[1].matchAll(/^\s*(\w+\??):/gm), (k) => k[1]);
}

test("payload: TokenBoardEntry and TokenBoard carry exactly their keys (a public TV board)", () => {
  const src = read("lib/token-view.ts");
  assert.deepEqual(interfaceKeys(src, "TokenBoardEntry"), ["id", "number", "firedAt", "readySince?"]);
  assert.deepEqual(interfaceKeys(src, "TokenBoard"), ["enabled", "preparing", "ready", "generatedAt"]);
});

/** Identifiers a public screen must never touch. `items`/`total` skip CSS classes such as `items-center`. */
const BANNED_FIELDS = [
  new RegExp("customer" + "Name"),
  new RegExp("paid" + "Amount"),
  new RegExp("recei" + "ver"),
  new RegExp("table" + "Name"),
  new RegExp("(?<![\\w-])(?:" + "tot" + "al|" + "ite" + "ms)(?![\\w-])"),
];
const bannedFieldIn = (src: string): string | null => BANNED_FIELDS.find((re) => re.test(src))?.source ?? null;

test("payload: no S9 file names a customer, an amount, a dish or a table (needles proven on samples)", () => {
  // Needle proof: real property access / identifiers hit, a CSS class does not.
  assert.ok(bannedFieldIn("const x = order." + "tot" + "al;"));
  assert.ok(bannedFieldIn("order." + "ite" + "ms.map(f)"));
  assert.ok(bannedFieldIn("{ " + "customer" + "Name }"));
  assert.equal(bannedFieldIn('<div className="flex ite' + 'ms-center">'), null, "items-center is CSS, not data");
  for (const file of S9_FILES) {
    assert.ok(raw(file).length > 0, `landmark: ${file} is read`);
    assert.equal(bannedFieldIn(raw(file)), null, `${file} must not name a customer, amount, dish or table`);
  }
});

// ── The bundle boundary ────────────────────────────────────────────────────────────────────────────────────────────

const BANNED_SPECIFIERS = [
  "@/lib/token" + "-board",
  "@/lib/token" + "-board-server",
  "@/lib/set" + "tings",
  "@/lib/" + "db",
  "mongo" + "ose",
];
const BANNED_PREFIXES = ["@/models/", "mongo" + "ose/"];
const bannedImportIn = (src: string): string | null =>
  specifiersOf(src).find((s) => BANNED_SPECIFIERS.includes(s) || BANNED_PREFIXES.some((p) => s.startsWith(p))) ?? null;

test("bundle: no S9 file imports the server-side token builder, a model, mongoose, the db or the settings loader", () => {
  assert.ok(specifiersOf(read(BOARD)).includes("@/lib/token-view"), "landmark: the board imports the client-safe token view");
  assert.ok(specifiersOf(read(PAGE)).includes("@/hooks/use-tokens"), "landmark: specifiers are really extracted");
  for (const file of S9_FILES) {
    assert.equal(bannedImportIn(read(file)), null, `${file} must stay client-safe`);
  }
});

// ── The announcer is pure ──────────────────────────────────────────────────────────────────────────────────────────

test("announcer: pure - no window, document, speech, audio or storage; the only import is a type", () => {
  const src = read(ANNOUNCER);
  assert.ok(src.includes("export function observeBoard"), "landmark: the announcer is the real file");
  for (const banned of ["window", "document", "speech" + "Synthesis", "Audio" + "Context", "local" + "Storage"]) {
    assert.ok(!new RegExp(`\\b${banned}\\b`).test(src), `the announcer must not touch ${banned}`);
  }
  const imports = src.split("\n").filter((l) => /^import\b/.test(l));
  assert.ok(imports.length >= 1, "landmark: it imports the board type");
  for (const line of imports) assert.match(line, /^import type \{[^}]*\} from "@\/lib\/token-view";$/);
});

// ── The prefs: own key, guarded storage ────────────────────────────────────────────────────────────────────────────

test("prefs: the own key literal, never the shared device-prefs blob, every storage access inside a try", () => {
  const src = read(PREFS);
  assert.equal(count(src, 'export const NOW_SERVING_PREFS_KEY = "pos.now-serving.v1";'), 1);
  assert.ok(existsSync(path.join(CAFE_ROOT, "lib", "pos-device-prefs.ts")), "landmark: the shared blob module exists");
  assert.ok(!specifiersOf(src).some((s) => /device-prefs/.test(s)), "no device-prefs import");
  assert.ok(!/pos\.device|DEVICE_PREFS/.test(src), "no device-prefs key");
  const uses = Array.from(src.matchAll(/localStorage\./g), (m) => m.index ?? -1);
  assert.equal(uses.length, 2, "landmark: one read, one write");
  for (const at of uses) {
    const tryAt = src.lastIndexOf("try {", at);
    const catchAt = src.lastIndexOf("catch", at);
    assert.ok(tryAt >= 0 && tryAt > catchAt, `localStorage access at ${at} must sit inside a try { ... } block`);
  }
});

// ── The sound hook ─────────────────────────────────────────────────────────────────────────────────────────────────

// Sound counts as on only when the shared context runs AND speech was primed by a gesture on this page (or the device
// cannot speak): the shell may unlock the chime before this page mounts, but WebKit drops speak() until then (review M3).
const AUDIBLE = "const audible = useCallback(() => isAlertSoundUnlocked() && (primedRef.current || !speechSupported()), []);";
const GESTURE_GATE = "if (soundOn) return;";
const gestureGateOk = (src: string): boolean =>
  src.includes(AUDIBLE) &&
  src.includes(GESTURE_GATE) &&
  src.includes("[soundOn, turnOnSound]") &&
  // every place that turns sound on asks audible() first
  count(src, "applySoundOn(true)") === count(src, "audible()) applySoundOn(true)");

test("sound hook: reuses the shared alert context and never builds or resumes its own", () => {
  const src = read(HOOK);
  assert.match(src, /import \{[^}]*\bunlockAlertSound\b[^}]*\} from "@\/lib\/alert-sound";/);
  assert.match(src, /import \{[^}]*\bisAlertSoundUnlocked\b[^}]*\} from "@\/lib\/alert-sound";/);
  assert.match(src, /import \{[^}]*\bplayAlertPing\b[^}]*\} from "@\/lib\/alert-sound";/);
  const ctor = "new Audio" + "Context";
  const resume = ".res" + "ume(";
  assert.ok(read("lib/alert-sound.ts").includes(ctor) && read("lib/alert-sound.ts").includes(resume), "landmark: the needles match the real owner");
  for (const file of S9_FILES) {
    const code = read(file);
    assert.ok(!code.includes(ctor), `${file}: no second AudioContext`);
    assert.ok(!code.includes(resume), `${file}: resume belongs to lib/alert-sound.ts`);
  }
});

test("sound hook: feature-detects speech, listens for voiceschanged both ways, cancels in the mount cleanup, never reads the user agent", () => {
  const src = read(HOOK);
  assert.equal(count(src, '"speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function"'), 1);
  assert.equal(count(src, 'addEventListener("voiceschanged"'), 1);
  assert.equal(count(src, 'removeEventListener("voiceschanged"'), 1);
  assert.ok(!/userAgent/i.test(src), "no UA sniffing (userAgent / userAgentData)");
  assert.ok(count(src, "function speechSupported()") === 1, "landmark: the capability helper exists");

  const mount = src.indexOf("aliveRef.current = true;");
  assert.ok(mount >= 0, "landmark: the mount effect");
  const end = src.indexOf("\n  }, [", mount);
  const effect = src.slice(mount, end);
  const cleanup = effect.indexOf("return () => {");
  assert.ok(cleanup > 0, "the mount effect returns a cleanup");
  const tail = effect.slice(cleanup);
  assert.ok(tail.includes("aliveRef.current = false;"));
  assert.ok(tail.includes("window.speechSynthesis.cancel()"), "the cleanup stops any speech in flight");
  assert.ok(!effect.slice(0, cleanup).includes("window.speechSynthesis.cancel()"), "the cancel is in the cleanup, not on mount");
});

test("sound hook: each token is called once, and the gesture listener stays until sound is on AND speech is primed", () => {
  const src = read(HOOK);
  assert.equal(count(src, "const ANNOUNCE_REPEAT = 1;"), 1);
  // ONE serial player: it waits for each chime and each utterance, so two tokens never talk over each other.
  assert.equal(count(src, "if (playingRef.current) return;"), 1);
  assert.equal(count(src, "await speakOnce(announcementText(item.number, current.language), voice, SPEECH_RATE);"), 1);
  assert.equal(count(src, "await sleep(CHIME_SETTLE_MS);"), 1);
  // While sound is off the calls are dropped (never queued for later, never played behind a "Sound is off" card).
  const observe = src.slice(src.indexOf("const { state, announce } = observeBoard("), src.indexOf("void runPlayer();"));
  assert.ok(observe.includes("if (!soundOnRef.current) {\n      queueRef.current = [];\n      return;\n    }"), "sound off drops the calls before the player");
  assert.ok(observe.indexOf("announcerRef.current = state;") < observe.indexOf("queueRef.current = [];"), "the announcer still advances while sound is off");
  assert.ok(gestureGateOk(src), "the tap listener stays until audible() (context running AND speech primed) turned sound on");
  const speak = src.indexOf("window.speechSynthesis.speak(prime);");
  const primed = src.indexOf("primedRef.current = true;");
  assert.ok(speak > 0, "landmark: the silent priming utterance is spoken");
  assert.equal(count(src, "primedRef.current = true"), 1);
  assert.ok(primed > speak, "primed flips only after the priming speak() call");
  // A touch pointerdown is not a user activation (HTML user-activation rules); a click is, for mouse and touch alike.
  assert.equal(count(src, 'window.addEventListener("click", onGesture, true);'), 1);
  assert.equal(count(src, 'window.removeEventListener("click", onGesture, true);'), 1);
  assert.ok(!src.includes("pointer" + "down"), "the gesture listener never relies on pointerdown");
  // Only a board fetched on THIS visit is observed: the cached one (and its optimistic copies) keep its server stamp
  // (review M4: isFetchedAfterMount flips on a failed refetch or an optimistic setQueryData).
  assert.equal(count(src, "const initialGeneratedAtRef = useRef(board?.generatedAt);"), 1);
  assert.equal(count(src, "if (!board || board.generatedAt === initialGeneratedAtRef.current) return;"), 1);
  for (const file of [HOOK, PAGE]) assert.ok(!/isFetchedAfterMount|fetchedAfterMount/.test(read(file)), file + ": no isFetchedAfterMount gate");
  const turnOn = src.lastIndexOf("const turnOnSound", speak);
  assert.ok(turnOn > 0 && !src.slice(turnOn, speak).includes("useEffect("), "priming happens inside turnOnSound (a gesture handler)");
});

// ── The links ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("sidebar: the Now Serving row sits right after Kitchen, is tokens-only, and the filter reads the live token switch", () => {
  const src = read(SIDEBAR);
  assert.match(
    src,
    /\{ title: "Kitchen", url: "\/kitchen", icon: ChefHat \},\s*\{ title: "Now Serving", url: "\/now-serving", icon: Tv, tokensOnly: true \},/,
  );
  assert.equal(count(src, 'url: "/now-serving"'), 1);
  assert.equal(count(src, "const tokensOn = printConfigOf(settings.data).token.enabled;"), 1);
  const adminFilter = src.indexOf("section.items.filter((item) => !item.adminOnly || isAdmin)");
  const tokenFilter = src.indexOf(".filter((item) => !item.tokensOnly || tokensOn)");
  assert.ok(adminFilter > 0, "landmark: the admin filter is intact");
  assert.ok(tokenFilter > adminFilter, "the tokens filter is chained after the admin filter");
});

test("NowServingLink: reads settings first, then returns only its children while tokens are off", () => {
  const src = read(LINK);
  const gate = "if (!printConfigOf(settings.data).token.enabled) return <>{children}</>;";
  assert.equal(count(src, gate), 1);
  const hook = src.indexOf("useSettings()");
  assert.ok(hook > 0, "landmark: the settings hook is called");
  assert.ok(hook < src.indexOf(gate), "every hook runs before the early return");
  assert.ok(src.includes('variant: "button" | "hint"'));
  // s83 deploy: importing the hint styles from SettingsFields dragged the settings field kit (Switch, Label, the
  // section list) into the Kitchen page's first load (191 -> 205 kB). The styles come from the light module.
  assert.ok(src.includes('from "@/components/settings/hint-classes";'), "landmark: the light hint-style module");
  assert.ok(!src.includes("components/settings/" + "SettingsFields"), "never the settings field kit");
  assert.ok(read("components/settings/SettingsFields.tsx").includes("export { HINT_CLASS, HINT_LINK_CLASS };"), "SettingsFields re-exports the same styles");
});

test("links: exactly one NowServingLink on the Kitchen header (button, wrapping the chip) and one under the token settings (hint)", () => {
  const kitchen = read(KITCHEN_PAGE);
  assert.equal(count(kitchen, "<NowServingLink"), 1);
  assert.ok(kitchen.includes('<NowServingLink variant="button"><KitchenFreshnessChip dataUpdatedAt={board.dataUpdatedAt} /></NowServingLink>'));
  const tokens = read(TOKENS_PAGE);
  assert.equal(count(tokens, "<NowServingLink"), 1);
  assert.ok(tokens.includes('<NowServingLink variant="hint" />'));
});

function sourceFilesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFilesUnder(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("INVENTORY: the quoted /now-serving path appears only in AppSidebar and NowServingLink", () => {
  const quoted = ['"', "'", "`"].map((q) => q + "/now-serving" + q);
  const hits = ["app", "components", "hooks", "lib"]
    .flatMap((dir) => sourceFilesUnder(path.join(CAFE_ROOT, dir)))
    .filter((file) => quoted.some((needle) => readFileSync(file, "utf8").includes(needle)))
    .map((file) => path.relative(CAFE_ROOT, file).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(hits, [SIDEBAR, LINK].sort());
});

test("access: /now-serving is not an admin route, and the middleware still gates every page on a session", () => {
  const constants = readFileSync(SHARED_CONSTANTS, "utf8");
  const block = /export const ADMIN_ROUTES = \[([\s\S]*?)\] as const;/.exec(constants);
  assert.ok(block, "landmark: ADMIN_ROUTES exists");
  const routes = Array.from(block[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
  assert.ok(routes.includes("/settings"), "landmark: the list is really parsed");
  assert.ok(!routes.includes("/now-serving"));
  assert.ok(!routes.some((r) => "/now-serving".startsWith(r)), "no admin prefix swallows it");
  assert.ok(read("middleware.ts").includes("if (!isLoggedIn)"), "any signed-in account passes; signed-out is redirected");
});

// ── CSS: the board stays inside its column ─────────────────────────────────────────────────────────────────────────

const BANNED_CSS = [
  new RegExp("d" + "vh"),
  new RegExp("cq(?:w|h|i|b|min|max)(?![a-z])"),
  new RegExp("@con" + "tainer"),
  new RegExp("w-scr" + "een"),
  new RegExp("100" + "vw"),
  new RegExp("overflow-x-" + "hidden"),
];
const bannedCssIn = (src: string): string | null => BANNED_CSS.find((re) => re.test(src))?.source ?? null;
const SIZE_CLASS = /^text-\[length:clamp\(\d+(?:\.\d+)?rem,min\(\d+(?:\.\d+)?vw,\d+(?:\.\d+)?vh\),\d+(?:\.\d+)?rem\)\]$/;
const sizeClassesOf = (src: string): string[] => Array.from(src.matchAll(/sizeClass: "([^"]+)"/g), (m) => m[1]);

test("css: no dvh, container queries, viewport-width boxes or hidden horizontal overflow in the screen files", () => {
  assert.equal(bannedCssIn("text-[10" + "cqw]"), BANNED_CSS[1].source, "needle proof: a container unit is caught");
  assert.equal(bannedCssIn('className="w-' + 'screen"'), BANNED_CSS[3].source, "needle proof: w-screen is caught");
  assert.equal(bannedCssIn("clamp(3rem,min(9vw,14vh),11rem) min-w-0"), null, "needle proof: the real classes pass");
  assert.ok(raw(COLUMN).includes("min-w-0"), "landmark: the column file is read");
  for (const file of SCREEN_FILES) assert.equal(bannedCssIn(raw(file)), null, `${file} must size by the shell, not the viewport box`);
});

test("css: every number size is clamp(rem, min(vw, vh), rem) - width keeps it in the column, height keeps it on screen", () => {
  const src = read(COLUMN);
  const sizes = sizeClassesOf(src);
  assert.equal(sizes.length, 3, "landmark: lg, md and sm");
  assert.match(src, /lg: \{ sizeClass: .*\n\s*md: \{ sizeClass: .*\n\s*sm: \{ sizeClass: /);
  for (const size of sizes) {
    assert.match(size, SIZE_CLASS);
    assert.ok(size.includes("vw") && size.includes("vh"), `${size} uses both vw and vh`);
  }
});

// ── The sound card and the board ───────────────────────────────────────────────────────────────────────────────────

test("sound settings: a pop-up (Dialog) driven by the page, with the plain-English copy", () => {
  const src = read(PANEL);
  assert.ok(specifiersOf(src).includes("@/components/ui/button"), "landmark: specifiers are really extracted");
  assert.ok(specifiersOf(src).includes("@/components/ui/dialog"), "owner s83: a proper pop-up");
  assert.ok(src.includes("<Dialog open={open} onOpenChange={onOpenChange}>"), "controlled by the page: never opens by itself");
  assert.ok(!/defaultOpen|<DialogTrigger/.test(src), "no self-opening trigger inside the pop-up");
  assert.ok(src.includes("Turn on sound"));
  assert.ok(src.includes("Sound did not start. Tap again."));
  assert.ok(src.includes("onClick={() => onOpenChange(false)}"), "Done closes it");
});

test("board: tokens-off is keyed on !board.enabled (before the empty state), and Ready is first on small screens", () => {
  const src = read(BOARD);
  const off = src.indexOf("if (!board.enabled) return <Notice>{OFF_TEXT}</Notice>;");
  const empty = src.indexOf("if (board.preparing.length === 0 && board.ready.length === 0)");
  assert.ok(off > 0 && empty > off, "the off branch comes first, then the empty state");
  assert.ok(src.includes("Tokens are off."));
  const preparing = /title="Preparing"[\s\S]*?\/>/.exec(src)?.[0] ?? "";
  const ready = /title="Ready"[\s\S]*?\/>/.exec(src)?.[0] ?? "";
  assert.ok(preparing.length > 0 && ready.length > 0, "landmark: both columns are rendered");
  assert.ok(preparing.includes('className="order-2 sm:order-1"'), "Preparing: second when stacked, left from sm");
  assert.ok(ready.includes('className="order-1 sm:order-2"'), "Ready: first when stacked, right from sm");
});

// ── Hygiene ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("hygiene: no console call, no any, no cafe name, and every S9 file within its line budget", () => {
  const anyRe = /:\s*any\b|\bas any\b|<any>/;
  assert.ok(anyRe.test("const x: " + "any = 1;") && anyRe.test("y as " + "any"), "needle proof: any is caught");
  for (const file of S9_FILES) {
    const text = raw(file);
    const code = read(file);
    assert.ok(code.includes("export"), `landmark: ${file} is read`);
    assert.ok(!text.includes("console" + "."), `${file}: no console call`);
    assert.ok(!anyRe.test(code), `${file}: no any`);
    assert.ok(!new RegExp("luci" + "fer", "i").test(text), `${file}: no cafe name`);
    const lines = text.split("\n").length;
    assert.ok(lines <= FILE_LINE_MAX, `${file} is ${lines} lines, over ${FILE_LINE_MAX}`);
  }
});

// ── The pins bite: each predicate is run on a mutated copy of the real source, in this process ─────────────────────

test("mutation sanity: the pins fail on the source change each one guards (no file is edited)", () => {
  const hook = read(HOOK);
  assert.ok(gestureGateOk(hook), "baseline: the real hook passes");
  assert.ok(!gestureGateOk(hook.replace("primedRef.current || ", "")), "dropping the priming term from audible() is caught");
  assert.ok(!gestureGateOk(hook.replace("if (audible()) applySoundOn(true);", "applySoundOn(true);")), "turning sound on without audible() is caught");

  const column = read(COLUMN);
  const sizes = sizeClassesOf(column);
  assert.ok(sizes.every((s) => SIZE_CLASS.test(s)), "baseline: the real sizes pass");
  assert.ok(!SIZE_CLASS.test(sizes[0].replace("14vh", "14vw")), "a size without a vh term is caught");
  assert.ok(!SIZE_CLASS.test(sizes[0].replace("clamp(", "min(")), "a size that is not a clamp is caught");

  const page = read(PAGE);
  assert.ok(page.includes("useTokenBoard({ enabled: true, background: true })"), "baseline: the real page passes");
  assert.ok(!page.replace("background: true", "background: false").includes("useTokenBoard({ enabled: true, background: true })"), "turning background polling off is caught");

  const board = read(BOARD);
  assert.equal(bannedImportIn(board), null, "baseline: the real board passes");
  assert.equal(bannedImportIn(board + '\nimport mon from "mongo' + 'ose";'), "mongo" + "ose", "a mongoose import is caught");
  assert.equal(bannedImportIn(board + '\nimport { b } from "@/lib/token' + '-board";'), "@/lib/token" + "-board", "the server board builder is caught");
});
