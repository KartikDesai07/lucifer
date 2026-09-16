// Pure URL validation/normalization for the desktop shell's saved server address.
// No electron imports — safe for node:test.

export const START_PATH = "/pos";
export const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;

export const URL_EMPTY_ERROR = "Enter the address of your POS.";
export const URL_INVALID_ERROR =
  "That is not a valid web address. It should look like https://your-pos.example.com";
export const URL_SCHEME_ERROR = "The address must start with https://";
export const URL_CREDENTIALS_ERROR = "Remove the user name and password from the address.";

export function startUrl(origin: string): string {
  return origin + START_PATH;
}

export type NormalizeResult = { ok: true; origin: string } | { ok: false; error: string };

export function normalizeServerUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: URL_EMPTY_ERROR };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: URL_INVALID_ERROR };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, error: URL_CREDENTIALS_ERROR };
  }

  if (url.protocol === "https:") {
    return { ok: true, origin: url.origin };
  }

  if (url.protocol === "http:" && LOCAL_HOSTNAMES.includes(url.hostname as (typeof LOCAL_HOSTNAMES)[number])) {
    return { ok: true, origin: url.origin };
  }

  return { ok: false, error: URL_SCHEME_ERROR };
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
