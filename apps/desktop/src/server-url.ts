// The start path and the origin checks for the desktop shell's saved POS address. The address itself is read by
// pos-url.ts (the Android app's rules, native apps 2.0). No electron imports — safe for node:test.

export const START_PATH = "/pos";

export function startUrl(origin: string): string {
  return origin + START_PATH;
}

export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export function isExternalHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
