// A network printer's address, checked the way the POS app checks it before it
// connects (apps/mobile/src/url.ts isValidHost): a dotted IPv4 with each part
// 0-255, or a DNS name made of letters, digits and hyphens. No ":" and no IPv6
// literal, no spaces or odd characters. Checking here means a typo is caught on
// the form, in plain words, instead of coming back from the app as a refusal.
// Pure and DOM-free; network-address.test.ts pins the constants to the app copy.

export const ADDRESS_MAX_CHARS = 253;
export const ADDRESS_LABEL_MAX_CHARS = 63;
export const ADDRESS_MESSAGE = "Enter the printer's IP address, like 192.168.1.50.";

const OCTET_MAX = 255;
const NUMERIC_HOST = /^[0-9.]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const OCTET = /^(0|[1-9]\d{0,2})$/;
// "host:port" as people paste it: one colon, digits after it.
const HOST_PORT = /^([^:\s]+):(\d{1,5})$/;

function isDottedIpv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => OCTET.test(part) && Number(part) <= OCTET_MAX);
}

/** The app's host rule, case-folded exactly as the app folds it before checking. */
export function isValidPrinterHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase();
  if (host.length === 0 || host.length > ADDRESS_MAX_CHARS) return false;
  if (NUMERIC_HOST.test(host)) return isDottedIpv4(host);
  return host.split(".").every((label) => label.length <= ADDRESS_LABEL_MAX_CHARS && LABEL.test(label));
}

/** A pasted "192.168.1.50:9100" as its two parts; null for anything else. */
export function splitHostPort(text: string): { host: string; port: string } | null {
  const match = HOST_PORT.exec(text.trim());
  return match === null ? null : { host: match[1], port: match[2] };
}
