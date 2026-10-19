// The HTML's eight staff hues (values 1.6): avBg = 18 % of the hue over the card,
// avFg = 80 % of the hue over the text colour, precomputed (no color-mix on WebView 109).
export const AVATAR_HUES: readonly { bg: string; fg: string }[] = [
  { bg: "#d7e2dc", fg: "#1e4e34" },
  { bg: "#d1e8e7", fg: "#056966" },
  { bg: "#eadcfe", fg: "#7337cf" },
  { bg: "#f7d8e5", fg: "#ac2460" },
  { bg: "#d4ebfb", fg: "#127abf" },
  { bg: "#f1e9d1", fg: "#937005" },
  { bg: "#d6e8db", fg: "#196b32" },
  { bg: "#f3dfd1", fg: "#9a4305" },
];

export function avatarHueIndex(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return sum % AVATAR_HUES.length;
}
