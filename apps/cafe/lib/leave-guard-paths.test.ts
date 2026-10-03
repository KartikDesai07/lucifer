// Source pins for the in-app "Discard changes?" guard (Settings slice 5). The
// pure decisions are table-tested in leave-guard.test.ts; these hold the wiring
// that no table can see: the click listener must run in the CAPTURE phase and
// swallow the click before next/link, Discard must replay the click, the guard
// history entry must keep Next's own state keys, and the dialog must actually be
// rendered by every settings page (a hook with no reachable call site is the
// "feature still dead" class).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const HOOK = "apps/cafe/hooks/use-in-app-leave-guard.ts";
const LIB = "apps/cafe/lib/leave-guard.ts";
const FORM_HOOK = "apps/cafe/hooks/use-settings-section-form.ts";
const FORM = "apps/cafe/components/settings/SettingsSectionForm.tsx";

test("PIN: the click listener is added AND removed on document in the capture phase, armed only while dirty", () => {
  const src = readSrc(HOOK);
  // Slice the click effect's OWN body: from its early return to its closing deps.
  const start = src.indexOf("if (!dirty) return;");
  assert.ok(start >= 0, "landmark: the click effect early-returns when not dirty");
  const end = src.indexOf("}, [dirty]);", start);
  assert.ok(end > start, "the click effect must close with deps exactly [dirty]");
  const effect = src.slice(start, end + "}, [dirty]);".length);
  assert.ok(effect.endsWith("}, [dirty]);"), "the click effect deps must be [dirty]");
  assert.ok(!effect.includes("useCallback("), "the slice must be the click effect alone");
  assert.match(effect, /document\.addEventListener\("click", onClick, true\)/, "must add the click listener with capture true");
  assert.match(effect, /document\.removeEventListener\("click", onClick, true\)/, "must remove it with the same capture flag");
});

test("PIN: a guarded click is swallowed (preventDefault + stopPropagation) before the dialog opens", () => {
  const src = readSrc(HOOK);
  const start = src.indexOf("const onClick = ");
  const end = src.indexOf('document.addEventListener("click"');
  assert.ok(start >= 0 && end > start, "landmarks: onClick handler precedes its addEventListener");
  const body = src.slice(start, end);
  const prevent = body.indexOf("e.preventDefault();");
  const stop = body.indexOf("e.stopPropagation();");
  const open = body.indexOf("setPrompting(true);");
  assert.ok(prevent >= 0, "must call e.preventDefault()");
  assert.ok(stop >= 0, "must call e.stopPropagation()");
  assert.ok(open > prevent && open > stop, "the dialog opens only after the click is swallowed");
  assert.match(body, /if \(bypassRef\.current\) return;/, "a replayed click must bypass the guard");
  assert.match(body, /if \(href === null\) return;/, "an unguarded link must pass through untouched");
});

test("PIN: the guard entry is pushed and re-marked through leaveGuardEntryState (keeps Next's keys); the window port writes real history", () => {
  const lib = readSrc(LIB);
  assert.match(lib, /port\.push\(leaveGuardEntryState\(port\.state\), port\.href\)/, "push must spread the current state via leaveGuardEntryState");
  assert.match(lib, /if \(onGuardEntry\) port\.replace\(leaveGuardEntryState\(port\.state\), port\.href\);/, "a stripped guard entry is re-marked in place, not pushed again");
  const hook = readSrc(HOOK);
  assert.match(hook, /push: \(state, href\) => window\.history\.pushState\(state, "", href\)/, "the port must push through window.history.pushState");
  assert.match(hook, /replace: \(state, href\) => window\.history\.replaceState\(state, "", href\)/, "the port must replace through window.history.replaceState");
  assert.match(hook, /back: \(\) => window\.history\.back\(\)/, "the port must go back through window.history.back");
});

test("PIN: leave discards, then replays the anchor click guarded by isConnected with a router.push fallback; the bypass lives ONLY in the link branch", () => {
  const src = readSrc(HOOK);
  const leaveAt = src.indexOf("const leave = useCallback(");
  assert.ok(leaveAt >= 0, "landmark: leave callback exists");
  const body = src.slice(leaveAt);
  const linkAt = body.indexOf('if (pending?.kind === "link") {');
  const backAt = body.indexOf('} else if (pending?.kind === "back") {');
  assert.ok(linkAt >= 0 && backAt > linkAt, "landmarks: link branch precedes back branch");
  const discard = body.indexOf("discard();");
  assert.ok(discard >= 0 && discard < linkAt, "the form is reset BEFORE either branch runs");
  const linkBranch = body.slice(linkAt, backAt);
  const backBranch = body.slice(backAt);
  assert.match(
    linkBranch,
    /bypassRef\.current = true;\s*if \(pending\.anchor\.isConnected\) pending\.anchor\.click\(\);\s*else router\.push\(pending\.href\);\s*bypassRef\.current = false;/,
    "replay .click() guarded by isConnected, router.push fallback, bypass set around it and cleared",
  );
  assert.ok(!backBranch.includes("bypassRef"), "the back branch must not use the bypass flag");
  assert.match(backBranch, /controllerRef\.current\?\.leaveBack\(\);/, "a pending Back is completed through the controller");
  assert.equal(src.split("bypassRef.current = true").length - 1, 1, "bypass is armed in exactly one place");
});

test("PIN: popstate and hashchange are forwarded to the controller, added AND removed on window, with no bypass in the popstate handler", () => {
  const src = readSrc(HOOK);
  assert.match(src, /const onPopState = \(e: PopStateEvent\) => controller\.onPopState\(e\.state\);/, "popstate must forward e.state to the controller");
  assert.match(src, /const onHashChange = \(\) => controller\.onHashChange\(\);/, "hashchange must reach the controller");
  for (const ev of ["popstate", "hashchange"]) {
    const fn = ev === "popstate" ? "onPopState" : "onHashChange";
    assert.ok(src.includes(`window.addEventListener("${ev}", ${fn})`), `must add ${ev} on window`);
    assert.ok(src.includes(`window.removeEventListener("${ev}", ${fn})`), `must remove ${ev} on window`);
  }
  const handlerStart = src.indexOf("const onPopState");
  const handlerEnd = src.indexOf("const onHashChange");
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "landmarks: popstate handler precedes hashchange handler");
  assert.ok(!src.slice(handlerStart, handlerEnd).includes("bypassRef"), "the popstate handler never reads a bypass");
});

test("PIN: the controller is created in a mount effect BEFORE the [dirty] effect feeds it setDirty(dirty)", () => {
  const src = readSrc(HOOK);
  assert.match(src, /useEffect\(\(\) => \{\s*controllerRef\.current\?\.setDirty\(dirty\);\s*\}, \[dirty\]\);/, "the [dirty] effect must call setDirty(dirty)");
  const created = src.indexOf("createLeaveGuardHistory(windowHistoryPort");
  const fed = src.indexOf("controllerRef.current?.setDirty(dirty)");
  assert.ok(created >= 0 && fed > created, "the controller exists before the dirty effect runs");
  assert.match(src, /if \(pending\?\.kind === "back"\) controllerRef\.current\?\.keepEditing\(\);/, "Keep editing re-arms the guard entry through the controller");
});

test("PIN: the controller decides through popstateDecision and keeps NO bypass flag (a no-op Back must not stick)", () => {
  const lib = readSrc(LIB);
  assert.match(lib, /popstateDecision\(\{ sameHref, state, dirty \}\)/, "onPopState must go through popstateDecision");
  const leaveAt = lib.indexOf("leaveBack() {");
  assert.ok(leaveAt >= 0, "landmark: leaveBack exists");
  assert.ok(!/bypass/i.test(lib), "lib/leave-guard.ts must not carry a bypass flag");
});

test("PIN: use-settings-section-form arms BOTH guards — beforeunload unchanged plus the in-app guard minus an in-flight save", () => {
  const src = readSrc(FORM_HOOK);
  assert.match(src, /useUnsavedGuard\(isDirty\);/, "beforeunload guard must stay exactly as is");
  assert.match(
    src,
    /useInAppLeaveGuard\(isDirty && !isSaving, discard\)/,
    "the in-app guard must be armed on isDirty && !isSaving with discard",
  );
  assert.match(src, /discard, leaveGuard \}/, "leaveGuard must be returned to the section form");
});

test("PIN: SettingsSectionForm renders the Discard changes dialog OUTSIDE the form, wired to the guard", () => {
  const src = readSrc(FORM);
  const formClose = src.indexOf("</form>");
  const dialog = src.indexOf("<ConfirmDialog");
  assert.ok(formClose >= 0, "landmark: the form element closes");
  assert.ok(dialog >= 0, "must render <ConfirmDialog");
  assert.ok(dialog > formClose, "the dialog must sit after </form>, not inside it");
  const tag = src.slice(dialog);
  assert.match(tag, /title="Discard changes\?"/);
  assert.match(tag, /cancelLabel="Keep editing"/);
  assert.match(tag, /confirmLabel="Discard"/);
  assert.match(tag, /open=\{leaveGuard\.prompting\}/);
  assert.match(tag, /onConfirm=\{leaveGuard\.leave\}/);
  assert.match(tag, /if \(!open\) leaveGuard\.keepEditing\(\);/, "closing the dialog any other way means Keep editing");
});
