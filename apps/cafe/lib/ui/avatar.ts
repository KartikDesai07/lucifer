export const AVATAR_HUES: readonly { bg: string; fg: string }[] = [
  { bg: "#f6f2ff", fg: "#6929c4" },
  { bg: "#d9fbfb", fg: "#005d5d" },
  { bg: "#defbe6", fg: "#0e6027" },
  { bg: "#edf5ff", fg: "#0043ce" },
  { bg: "#fff0f7", fg: "#9f1853" },
  { bg: "#fcf4d6", fg: "#8e6a00" },
];

export function avatarHueIndex(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return sum % AVATAR_HUES.length;
}
