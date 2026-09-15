// Pure persisted-settings store for the desktop shell. node:fs + node:path only
// (no electron imports) — safe for node:test.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { normalizeServerUrl } from "./server-url";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShellStore {
  serverOrigin: string | null;
  deviceName: string | null;
  autoStart: boolean | null;
  windowBounds: WindowBounds | null;
}

export const STORE_FILE_NAME = "pos-desktop.json";

export const DEFAULT_STORE: ShellStore = {
  serverOrigin: null,
  deviceName: null,
  autoStart: null,
  windowBounds: null,
};

function normalizeWindowBounds(raw: unknown): WindowBounds | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const keys: (keyof WindowBounds)[] = ["x", "y", "width", "height"];
  const out: Partial<WindowBounds> = {};
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) {
      return null;
    }
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    out[key] = value;
  }
  return { x: out.x as number, y: out.y as number, width: out.width as number, height: out.height as number };
}

export function normalizeStore(raw: unknown): ShellStore {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_STORE };
  }

  const source = raw as Record<string, unknown>;

  let serverOrigin: string | null = null;
  if (Object.hasOwn(source, "serverOrigin") && typeof source.serverOrigin === "string") {
    const normalized = normalizeServerUrl(source.serverOrigin);
    serverOrigin = normalized.ok ? normalized.origin : null;
  }

  let deviceName: string | null = null;
  if (
    Object.hasOwn(source, "deviceName") &&
    typeof source.deviceName === "string" &&
    source.deviceName.length > 0
  ) {
    deviceName = source.deviceName;
  }

  let autoStart: boolean | null = null;
  if (Object.hasOwn(source, "autoStart") && typeof source.autoStart === "boolean") {
    autoStart = source.autoStart;
  }

  const windowBounds = Object.hasOwn(source, "windowBounds") ? normalizeWindowBounds(source.windowBounds) : null;

  return { serverOrigin, deviceName, autoStart, windowBounds };
}

export function readStore(file: string): ShellStore {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return normalizeStore(raw);
  } catch {
    return { ...DEFAULT_STORE };
  }
}

export function writeStore(file: string, store: ShellStore): void {
  const tmpFile = `${file}.tmp`;
  // Pretty-printed: deviceName is edited by hand in this file (no picker in v1).
  writeFileSync(tmpFile, JSON.stringify(store, null, 2) + "\n");
  renameSync(tmpFile, file);
}
