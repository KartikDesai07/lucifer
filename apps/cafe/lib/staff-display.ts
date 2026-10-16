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
