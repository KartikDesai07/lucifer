// The only logging sink for the desktop shell. No console.* anywhere else —
// callers must never pass HTML or cookies into these messages.
import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { LOG_MAX_BYTES } from "./shared";

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

function append(file: string, level: "INFO" | "ERROR", msg: string): void {
  try {
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      size = 0; // missing file: nothing to truncate
    }
    if (size > LOG_MAX_BYTES) {
      try {
        writeFileSync(file, "");
      } catch {
        // best-effort truncate; fall through and still try to append
      }
    }
    appendFileSync(file, `${new Date().toISOString()} ${level} ${msg}\n`);
  } catch {
    // logging must never throw into the caller
  }
}

export function createLogger(file: string): Logger {
  return {
    info(msg: string): void {
      append(file, "INFO", msg);
    },
    error(msg: string): void {
      append(file, "ERROR", msg);
    },
  };
}
