// Printing Phase 4 (spec 2026-10-15 §4.2): the characters a text KOT may send. Only printable ASCII (0x20-0x7E) reaches
// the printer, so no code page command is sent and every ESC/POS printer prints the same characters in every code page.
// A few characters today's kitchen tickets print are mapped to ASCII first; any other character makes the whole slip a
// picture (spec §4.1 rule 6), so a Hindi or Gujarati menu, an accented letter or an emoji never prints as text.
// Characters are named by code point (never typed into this file), so an invisible one cannot slip in unseen.

/** The printable ASCII range: the only bytes a text KOT's characters become. */
export const PRINTABLE_MIN = 0x20;
export const PRINTABLE_MAX = 0x7e;

const MAPPED: ReadonlyArray<readonly [number, string]> = [
  [0x20b9, "Rs "], // the rupee sign: "Rs 240" (owner, 2026-10-15)
  [0x00d7, "x"], // the multiplication sign: "2 x Masala Chai"
  [0x2192, "->"], // the arrow of a moved table: "T-1 -> T-4"
  [0x2014, "-"], // the em dash: "FOOD ALREADY ORDERED - DO NOT MAKE AGAIN"
  [0x2013, "-"], // the en dash
  [0x25b8, ">"], // Classic's instruction mark
  [0x00bb, ">>"], // Kitchen Bold's instruction mark
  [0x00b7, "-"], // the middle dot between joined labels: "BACKUP PRINTER - REPRINT"
  [0x2018, "'"], // curly single quotes
  [0x2019, "'"],
  [0x201c, '"'], // curly double quotes
  [0x201d, '"'],
  [0x2026, "..."], // the ellipsis
  [0x00a0, " "], // the no-break space
  [0x202f, " "], // the narrow no-break space (a time on newer ICU: "02:35 pm")
];

/** Each mapped character and its ASCII text. Nothing else is mapped. */
export const TEXT_CHAR_MAP: ReadonlyMap<string, string> = new Map(MAPPED.map(([code, to]) => [String.fromCharCode(code), to]));

/** The text as printable ASCII, or null when it holds a character text mode cannot print. Line breaks are kept (as
 *  LF) for the caller to decide on; a carriage return is dropped and a tab is a space. */
export function asciiText(text: string): string | null {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX) out += char;
    else if (char === "\n") out += "\n";
    else if (char === "\t") out += " ";
    else if (char !== "\r") {
      const mapped = TEXT_CHAR_MAP.get(char);
      if (mapped === undefined) return null;
      out += mapped;
    }
  }
  return out;
}
