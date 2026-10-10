import type { PrintQrSize, QrContent, QrOptions } from "@pos/shared/print-template";

// The QR line's option edits as pure functions (QrOptionsFields calls them), so what a content switch or an edit
// keeps is pinned without a browser. Every one returns a NEW object and leaves the other choices exactly as they were.

/** A caption left empty is removed, never saved as "" (the save gate asks a caption to hold text or be absent). */
export function withCaption(options: QrOptions, caption: string): QrOptions {
  const next: QrOptions = { ...options };
  delete next.caption;
  return caption === "" ? next : { ...next, caption };
}

/** Normal REMOVES the key (absent = normal, like an empty caption), so an untouched design keeps its stored shape. */
export function withSize(options: QrOptions, size: PrintQrSize): QrOptions {
  const next: QrOptions = { ...options };
  delete next.size;
  return size === "normal" ? next : { ...next, size };
}

/** Switching what the code opens starts that content from scratch but carries the caption and the size across. */
export function withContent(options: QrOptions, content: QrContent): QrOptions {
  if (content === options.content) return options;
  const fresh: QrOptions = content === "upi" ? { content: "upi" } : { content: "link", url: "" };
  return withSize(withCaption(fresh, options.caption ?? ""), options.size ?? "normal");
}
