// Diner free-text hardening — split out of public.ts (CR2, phase CR2-public-
// ordering) only to keep that file under this repo's ~300-line budget; no
// semantic change. Pure and client-safe, same as public.ts.

// ── Free-text hardening ─────────────────────────────────────────────────────
// Diner text reaches a thermal slip and the admin panel, so it is capped here
// and stripped of control characters before storage. These bounds are the public
// surface's own — deliberately tighter than the staff-facing equivalents.
export const PUBLIC_NOTE_MAX_LEN = 200;
export const PUBLIC_NAME_MAX_LEN = 40;

// Codepoints replaced by sanitizePublicText, beyond the C0/DEL range checked
// inline below. Written as \uXXXX-derived numeric literals only — never a
// literal control/invisible character in source (this repo has been bitten by
// exactly that: it renders invisibly and an editor's Edit tool can't match it).
//   - C1 controls (0x80–0x9F): the same injection primitive as C0, just in the
//     Latin-1 supplement range a bare `< 0x20` check misses entirely.
//   - Bidi controls (U+061C, U+200E/F, U+202A–U+202E, U+2066–U+2069): can
//     reorder how a slip line RENDERS without changing what characters it
//     contains — e.g. hiding a real instruction behind reversed/overlaid text.
//   - Zero-width/invisible (U+200B–U+200D, U+2060, U+FEFF): invisible in both
//     the panel and on paper, so they'd otherwise sail through unnoticed and
//     could be used to defeat exact-text matching or padding limits.
function isHardenedControlCode(code: number): boolean {
  if (code < 0x20 || code === 0x7f) return true; // C0 + DEL
  if (code >= 0x80 && code <= 0x9f) return true; // C1
  if (code === 0x061c) return true; // Arabic Letter Mark
  if (code === 0x200e || code === 0x200f) return true; // LRM / RLM
  if (code >= 0x202a && code <= 0x202e) return true; // bidi embedding/override
  if (code >= 0x2066 && code <= 0x2069) return true; // bidi isolates
  if (code >= 0x200b && code <= 0x200d) return true; // ZWSP / ZWNJ / ZWJ
  if (code === 0x2060) return true; // word joiner
  if (code === 0xfeff) return true; // BOM / zero-width no-break space
  return false;
}

// Strips control, bidi-override and zero-width/invisible characters, keeping
// ordinary spaces. These are the injection primitives for ESC/POS-style
// printer attacks and, short of that, corrupt a receipt's layout or hide text
// invisibly in the panel. Collapses runs of whitespace so a diner cannot pad a
// slip with 200 blank columns.
export function sanitizePublicText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Replaced with a SPACE rather than dropped: a diner who types a newline
    // between two requests means two words, and deleting it outright would glue
    // them into one ("no onion" + "extra ghee" -> "no onionextra ghee").
    out += isHardenedControlCode(code) ? " " : char;
  }
  return out.replace(/\s+/g, " ").trim();
}
