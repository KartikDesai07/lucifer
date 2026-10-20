export type PinKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "clear" | "back";

/** The value after one key press: digits append up to `length`, "back" drops one, "clear" empties. */
export function pinPadNext(value: string, key: PinKey, length = 4): string {
  if (key === "clear") return "";
  if (key === "back") return value.slice(0, -1);
  return value.length >= length ? value : value + key;
}

/** Map a keyboard `key` to a pad key: digits, Backspace (back), Delete (clear); anything else is not ours. */
export function pinKeyFromKeyboard(key: string): PinKey | null {
  if (/^[0-9]$/.test(key)) return key as PinKey;
  if (key === "Backspace") return "back";
  if (key === "Delete") return "clear";
  return null;
}
