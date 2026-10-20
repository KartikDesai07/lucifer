function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** "Priya Sharma" -> "Priya S."; one word stays; the first name is kept as given. */
export function shortStaffName(name: string): string {
  const w = words(name);
  if (w.length === 0) return "";
  if (w.length === 1) return w[0];
  return `${w[0]} ${w[w.length - 1].charAt(0).toUpperCase()}.`;
}

/** "Priya Sharma" -> "PS"; "Priya" -> "PR"; nothing -> "?". */
export function staffInitials(name: string): string {
  const w = words(name);
  if (w.length === 0) return "?";
  const raw = w.length === 1 ? w[0].slice(0, 2) : w[0].charAt(0) + w[w.length - 1].charAt(0);
  return raw.toUpperCase();
}

/**
 * The name each sign-in tile shows (the owner's HTML, values 4.3; ruling R29): the short name ("Priya S."), unless
 * another of the tiles on screen would read the same, when those tiles show the full name instead (the tile ellipsises
 * a long one), so nobody picks the wrong person. Keyed by the person's id.
 */
export function tileNames(people: readonly { id: string; name: string; shortName: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const p of people) seen.set(p.shortName, (seen.get(p.shortName) ?? 0) + 1);
  return new Map(people.map((p) => [p.id, (seen.get(p.shortName) ?? 0) > 1 ? p.name : p.shortName]));
}
