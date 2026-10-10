import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Settings > Appearance post-review pins (slice 9, s71): the colour status is
// always mounted and describes the picker, the tile groups are real radio
// groups, the banner upload says "Banner picture", the narrow-column grids and
// the first-group spacing. Companion to appearance-settings-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(readSrc(rel));

const SETTINGS = "apps/cafe/components/settings";
const FIELDS = `${SETTINGS}/AppearanceFields.tsx`;
const THEME = `${SETTINGS}/AppearanceThemeGroup.tsx`;
const ACCENT_INPUT = `${SETTINGS}/AppearanceAccentInput.tsx`;
const TEXT_LAYOUT = `${SETTINGS}/AppearanceTextLayoutGroup.tsx`;
const PREVIEW = `${SETTINGS}/AppearancePreview.tsx`;
const UPLOAD = "apps/cafe/components/shared/ImageUpload.tsx";
const BRANDING_ROUTE = "apps/cafe/app/api/branding/[slot]/route.ts";

test("PIN: the colour status <p> is always mounted (not behind a !feedback.ok conditional) and the picker is described by it", () => {
  const src = code(ACCENT_INPUT);
  assert.match(src, /const feedback = untouchedDefault \?/, "landmark: the feedback guard is still here");
  const status = src.match(/<p\s+id=\{statusId\}\s+role="status"[\s\S]*?<\/p>/);
  assert.ok(status, "the status paragraph carries id={statusId} and role=status");
  assert.ok(!/!feedback\.ok\s*&&\s*\(?\s*<p\b/.test(src), "no conditional mount around the paragraph");
  assert.match(status[0], /feedback\.ok \? "sr-only" : "order-last w-full"/, "empty = sr-only ALONE (w-full would beat its 1px width and overflow the page); a full-width line only when shown");
  assert.match(status[0], /feedback\.ok \? null : accentProblemText\(feedback\.reason\)/, "empty when fine, plain text when not");
  assert.match(src, /<PopoverTrigger asChild>\s*<button[^>]*\baria-describedby=\{statusId\}/, "the picker's trigger is described by the status");
  assert.match(src, /const statusId = useId\(\)/, "one id per instance");
});

test("PIN: the theme tiles and the font tiles are each ONE radio group - a shared name from useId, a controlled checked", () => {
  for (const rel of [THEME, TEXT_LAYOUT]) {
    const src = code(rel);
    assert.match(src, /type="radio"/, `${rel}: landmark - native radios`);
    assert.match(src, /const name = useId\(\)/, `${rel}: one name per group, from useId`);
    assert.match(src, /name=\{name\}/, `${rel}: every radio shares it`);
    assert.match(src, /checked=\{selected\}/, `${rel}: controlled by the form value`);
    assert.match(src, /const selected = value === (id|key);/, `${rel}: selected is the form value`);
    assert.match(src, /onChange=\{\(\) => onChange\((id|key)\)\}/, `${rel}: a pick writes the form value`);
  }
});

test("PIN: the banner upload slot label is Banner picture in BOTH the client and the route (they mirror each other)", () => {
  const needle = /const SLOT_LABELS: Record<BrandingSlot, string> = \{[^}]*heroImage: "Banner picture",[^}]*\};/;
  for (const rel of [UPLOAD, BRANDING_ROUTE]) {
    const src = code(rel);
    assert.match(src, /logo: "Logo"/, `${rel}: landmark - the map is still here`);
    assert.match(src, needle, `${rel}: heroImage reads Banner picture`);
  }
});

test("PIN: the dark-mode hint says a diner can choose light themselves", () => {
  const src = code(PREVIEW);
  assert.ok(src.includes("Diners see the dark version when their phone is in dark mode, unless they choose light themselves."));
  assert.ok(!src.includes("set to dark mode see the dark version"), "the absolute wording is gone");
});

test("PIN: the theme and font grids drop to 2 columns at lg (the narrow left column) and return to 3 at xl", () => {
  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3";
  for (const rel of [THEME, TEXT_LAYOUT]) {
    assert.ok(code(rel).includes(`"${grid}"`), `${rel}: ${grid}`);
  }
});

test("PIN: the left column drops the first group's top border and padding at lg, so it lines up with the Preview heading", () => {
  const src = code(FIELDS);
  assert.match(src, /export function AppearanceFields\(/, "landmark");
  const column = src.match(/<div className="(space-y-6 [^"]*first-of-type[^"]*)">/);
  assert.ok(column, "the left column carries the first-section override");
  assert.match(column[1], /lg:\[&>section:first-of-type\]:border-t-0/);
  assert.match(column[1], /lg:\[&>section:first-of-type\]:pt-0/);
});
