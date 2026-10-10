// Print customization S9 — the Now Serving screen's announcer: the PURE decision of which Ready tokens to call out
// loud. No window, no document, no speech, no audio, no storage — the sound hook (hooks/use-now-serving-sound.ts)
// owns every browser API and only asks this file "what is new?". Client-safe: the one import is a type.
import type { TokenBoard, TokenBoardEntry } from "@/lib/token-view";

export const NOW_SERVING_LANGUAGES = ["en", "hi"] as const;
export type NowServingLanguage = (typeof NOW_SERVING_LANGUAGES)[number];

/** A Ready mark older than this (server time, both stamps) is never called: a network gap must not replay old calls. */
export const ANNOUNCE_FRESH_MS = 120_000;
/** The most calls waiting their turn; past it the newest ten stay. */
export const ANNOUNCE_QUEUE_MAX = 10;
/** The most Ready keys remembered; past it the oldest are forgotten first. */
export const KNOWN_KEYS_MAX = 1000;

export interface AnnouncerState {
  seeded: boolean;
  enabled: boolean;
  /** The newest board.generatedAt processed (ms), null before the first parseable one. */
  lastGeneratedMs: number | null;
  /** Ready keys already called (or present when the screen opened). */
  known: readonly string[];
}

export const INITIAL_ANNOUNCER_STATE: AnnouncerState = {
  seeded: false,
  enabled: false,
  lastGeneratedMs: null,
  known: [],
};

export interface Announcement {
  key: string;
  number: number;
}

/** One Ready mark: the order plus the server instant of that mark, so a re-tap or a second Ready is a new key. */
export function readyKeyOf(e: TokenBoardEntry): string {
  return `${e.id}@${e.readySince ?? ""}`;
}

// Existing keys first, then the new ones, newest KNOWN_KEYS_MAX kept.
function mergeKnown(known: readonly string[], keys: readonly string[]): string[] {
  const have = new Set(known);
  const merged = [...known];
  for (const key of keys) {
    if (!have.has(key)) {
      have.add(key);
      merged.push(key);
    }
  }
  return merged.length > KNOWN_KEYS_MAX ? merged.slice(merged.length - KNOWN_KEYS_MAX) : merged;
}

function readyStampMs(e: TokenBoardEntry): number {
  return e.readySince === undefined ? Number.NaN : Date.parse(e.readySince);
}

// An unparseable stamp sorts after every parseable one.
function readyMsOf(e: TokenBoardEntry): number {
  const ms = readyStampMs(e);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function byReadyThenNumber(a: TokenBoardEntry, b: TokenBoardEntry): number {
  const am = readyMsOf(a);
  const bm = readyMsOf(b);
  if (am !== bm) return am < bm ? -1 : 1;
  return a.number - b.number;
}

// Fresh unless BOTH stamps parse and the mark is older than ANNOUNCE_FRESH_MS (both are server stamps, so client
// clock skew is irrelevant).
function isFresh(generatedMs: number, e: TokenBoardEntry): boolean {
  const ms = readyStampMs(e);
  if (!Number.isFinite(ms) || !Number.isFinite(generatedMs)) return true;
  return generatedMs - ms <= ANNOUNCE_FRESH_MS;
}

/** Folds one board into the announcer: the new state and the Ready tokens to call now (oldest mark first). */
export function observeBoard(
  state: AnnouncerState,
  board: TokenBoard,
): { state: AnnouncerState; announce: Announcement[] } {
  const g = Date.parse(board.generatedAt);
  // Rule 1: an older or equal board (an out-of-order reply, an optimistic copy) changes nothing.
  if (Number.isFinite(g) && state.lastGeneratedMs !== null && g <= state.lastGeneratedMs) {
    return { state, announce: [] };
  }
  const last = Number.isFinite(g) ? g : state.lastGeneratedMs;
  if (!board.enabled) {
    return { state: { seeded: true, enabled: false, lastGeneratedMs: last, known: state.known }, announce: [] };
  }
  const readyKeys = board.ready.map(readyKeyOf);
  // Seed: the first load, and tokens coming back on, announce nothing.
  if (!state.seeded || !state.enabled) {
    return {
      state: { seeded: true, enabled: true, lastGeneratedMs: last, known: mergeKnown(state.known, readyKeys) },
      announce: [],
    };
  }
  const have = new Set(state.known);
  const fresh = board.ready
    .filter((e) => !have.has(readyKeyOf(e)) && isFresh(g, e))
    .sort(byReadyThenNumber)
    .map((e) => ({ key: readyKeyOf(e), number: e.number }));
  return {
    state: { seeded: true, enabled: true, lastGeneratedMs: last, known: mergeKnown(state.known, readyKeys) },
    announce: fresh,
  };
}

/** Adds to the waiting calls: a key already waiting is dropped; past ANNOUNCE_QUEUE_MAX the last ten stay. */
export function enqueueAnnouncements(queue: readonly Announcement[], add: readonly Announcement[]): Announcement[] {
  const queued = new Set(queue.map((a) => a.key));
  const next = [...queue];
  for (const item of add) {
    if (!queued.has(item.key)) {
      queued.add(item.key);
      next.push(item);
    }
  }
  return next.length > ANNOUNCE_QUEUE_MAX ? next.slice(next.length - ANNOUNCE_QUEUE_MAX) : next;
}

/** A token collected (or un-readied) before its turn is never called; tokens off clears the queue. */
export function pruneQueue(queue: readonly Announcement[], board: TokenBoard): Announcement[] {
  if (!board.enabled) return [];
  const stillReady = new Set(board.ready.map(readyKeyOf));
  return queue.filter((a) => stillReady.has(a.key));
}

export function announcementText(n: number, language: NowServingLanguage): string {
  return language === "hi" ? `टोकन नंबर ${n}` : `Token number ${n}`;
}

interface VoiceLike {
  lang: string;
  localService?: boolean;
  default?: boolean;
}

const VOICE_REGION_IN = "in";

function normalLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, "-");
}

function primaryOf(lang: string): string {
  return normalLang(lang).split("-")[0] ?? "";
}

// Among equals a voice that runs on the device beats a network one; the first listed wins a tie.
function bestOf<V extends VoiceLike>(candidates: readonly V[]): V | null {
  return candidates.find((v) => v.localService === true) ?? candidates[0] ?? null;
}

/** The device voice for a language: never another language, null when there is none. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language: NowServingLanguage): V | null {
  const same = voices.filter((v) => primaryOf(v.lang) === language);
  if (same.length === 0) return null;
  const indian = same.filter((v) => normalLang(v.lang) === `${language}-${VOICE_REGION_IN}`);
  if (language === "hi") return bestOf(indian) ?? bestOf(same);
  return (
    bestOf(indian) ??
    bestOf(same.filter((v) => v.default === true)) ??
    bestOf(same.filter((v) => v.localService === true)) ??
    bestOf(same)
  );
}

export type VoiceStatus = "checking" | "ready" | "missing" | "unsupported";

const LANGUAGE_NAMES: Record<NowServingLanguage, string> = { en: "English", hi: "Hindi" };

/** The line shown when the voice is wanted but cannot speak; null when there is nothing to say. */
export function voiceNoticeOf(status: VoiceStatus, language: NowServingLanguage, voice: boolean): string | null {
  if (!voice) return null;
  if (status === "unsupported") return "This screen cannot speak, so it plays only the chime.";
  if (status === "missing") return `This device has no ${LANGUAGE_NAMES[language]} voice, so it plays only the chime.`;
  return null;
}
