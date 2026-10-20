import type { ComponentType } from "react";

// The owner's HTML nav glyphs (values 2.4 and 5: 24x24 outline paths, drawn at 20 px with a 1.6 stroke, round caps
// and joins), for the nine screens the HTML has. Our other screens use lucide icons at the same size and stroke.

/** What a nav row's icon accepts: a lucide icon or one of the HTML glyphs below. */
export type NavIcon = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" }>;

function glyph(d: string, name: string): NavIcon {
  function NavGlyph({ className, strokeWidth = 1.6, ...rest }: { className?: string; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" }) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...rest}
      >
        <path d={d} />
      </svg>
    );
  }
  NavGlyph.displayName = name;
  return NavGlyph;
}

export const NavHome = glyph("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z", "NavHome");
export const NavFloor = glyph("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", "NavFloor");
export const NavOrder = glyph("M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01", "NavOrder");
export const NavOrders = glyph("M8 4h8v3H8zM6 6H5v15h14V6h-1M9 12h6M9 16h4", "NavOrders");
export const NavKitchen = glyph("M6 13a6 6 0 1 1 12 0v2H6zM5 19h14M12 7V4", "NavKitchen");
export const NavBookings = glyph("M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h3v3H8z", "NavBookings");
export const NavMenu = glyph("M5 4h14v16H5zM9 9h6M9 13h6M9 17h3", "NavMenu");
export const NavReports = glyph("M4 20V10M10 20V4M16 20v-7M22 20H2", "NavReports");
export const NavSettings = glyph(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  "NavSettings",
);

// The page header's glyphs (values 2.5 and 5): New order's plus (14px, stroke 2.4) and the printer (17px on the
// printer button, 15px on End of day; stroke 1.8). The size and stroke come from where they are drawn.
export const GlyphPlus = glyph("M12 5v14M5 12h14", "GlyphPlus");

// The phone tab bar's More (three lines; 22px, stroke 1.7) and the profile sheet's rows (18px, stroke 1.7): the
// padlock (Lock screen) and the door bracket with its arrow pointing in (Switch user). Values 2.6, 2.7 and 5.
export const GlyphMore = glyph("M4 6h16M4 12h16M4 18h16", "GlyphMore");
export const GlyphLock = glyph("M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3", "GlyphLock");
export const GlyphSwitch = glyph("M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11", "GlyphSwitch");
export const GlyphPrinter = glyph("M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z", "GlyphPrinter");
