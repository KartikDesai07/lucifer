import { readPublicAppearance } from "@/lib/public-appearance";
import { FONT_PAIR_CLASSNAMES, FONT_PAIR_FAMILIES } from "@/lib/public-fonts";
import { appearanceScopedCss } from "@pos/shared/appearance";

// CR2.4 S3 — server-renders the diner theme for every /m route, killing the
// flash-of-default-theme a client-only theme switch would show on every scan.
//
// No `export const revalidate` here (A3 — ISR was the original plan, but the
// ROOT layout does `await auth()`, a Dynamic API with no PPR, which makes
// EVERY /m render dynamic regardless of what this layout exports; a
// revalidate export here would be dead config). The actual freshness bound is
// lib/settings.ts's TTL.SETTINGS cache (~45s) that readPublicAppearance reads
// through — same class of bound the public menu route already accepts.
export default async function PublicMenuLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const appearance = await readPublicAppearance();
  const fontFamilies = FONT_PAIR_FAMILIES[appearance.fontPairKey];

  return (
    <>
      {/* The SOLE producer of this text is appearanceScopedCss (A11) — this
          file builds no CSS of its own, and never reaches for the raw-HTML
          escape hatch. A plain <style> string child is NOT escaped the way an
          ordinary text node is: React's renderer only rewrites the literal
          substrings "<style"/"</style" (so this text can't early-close its
          own tag) and passes &, <, >, and quotes straight through verbatim —
          so the WHOLE defense here is appearanceScopedCss's own re-validation
          (HEX_COLOR_PATTERN on every color token + assertSafeFontFamily's
          angle-bracket/ampersand guard on the font strings), not anything
          React does on the way out. */}
      <style>{appearanceScopedCss(appearance, fontFamilies)}</style>
      {/* TWO mechanisms are both required (A2/A9), not one: the .variable
          classes below make Next inject the selected pair's own @font-face
          rules for THIS subtree, while the :root custom properties emitted
          by the <style> above are what let body-level PORTALS (the cart
          Drawer, an item Sheet, the sonner Toaster) — none of which mount
          inside this div — inherit the same palette and fonts. Dropping
          either one leaves either this subtree or every portal unthemed. */}
      <div
        className={`pos-public-theme min-h-dvh bg-background text-foreground font-pub-body ${FONT_PAIR_CLASSNAMES[appearance.fontPairKey]}`}
      >
        {children}
      </div>
    </>
  );
}
