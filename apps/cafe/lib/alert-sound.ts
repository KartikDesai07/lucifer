// CR2.3 §20 — the staff-attention "pulse" alert's sound: one shared,
// module-singleton AudioContext plus a synthesized two-tone ping (NO audio
// asset). Everything here is try/caught — a browser that blocks/lacks Web
// Audio must never break the rest of the app, it just stays silent.
//
// Chrome's autoplay policy: an AudioContext created before any user gesture
// starts SUSPENDED, and resume() must be called from INSIDE a real gesture
// handler (a click/keydown/pointerdown) — never from a setTimeout or a
// network callback — or the browser silently keeps it suspended forever
// (developer.chrome.com/blog/autoplay/#webaudio). `unlockAlertSound()` is
// the ONLY function here allowed to construct the context or call resume(),
// and callers must invoke it directly from a gesture handler.
//
// Sound while the browser tab is hidden/backgrounded is NOT guaranteed by
// any browser — this module's design never depends on it; the visual badge
// and the document.title prefix (PosPulseProvider) are the alert path that
// keeps working regardless of tab visibility.
//
// Nothing below runs at module scope: the AudioContext is created lazily,
// on the first unlock call, never on import.

const TONE_ONE_HZ = 880; // A5 — the ping's first, lower tone
const TONE_TWO_HZ = 1175; // D6 — the ping's second, higher tone
const TONE_DURATION_MS = 120; // each tone's length
const TONE_GAP_SEC = TONE_DURATION_MS / 1000;
const RAMP_MS = 15; // gain ramp in/out — avoids the audible "click" of a hard on/off
const PING_GAIN = 0.2; // quiet enough for a counter, audible over ambient noise

let ctx: AudioContext | null = null;
let unlocked = false;

/** Call ONLY from inside a real user-gesture event handler (a click,
 * pointerdown, or keydown) — creates the shared AudioContext if it doesn't
 * exist yet and resumes it, per Chrome's autoplay policy (see file header).
 * Safe to call repeatedly; a second call while already unlocked is a no-op. */
export function unlockAlertSound(): void {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      ctx = new AudioContext();
    }
    const context = ctx;
    if (context.state === "suspended") {
      void context.resume().then(() => {
        unlocked = context.state === "running";
      });
    } else {
      unlocked = context.state === "running";
    }
  } catch {
    // Web Audio unsupported or blocked — the alert stays visual-only.
  }
}

/** Whether the shared AudioContext is currently unlocked (running). Callers
 * gate `playAlertPing()` on this so an un-gestured tick never even attempts
 * to play (it would silently do nothing anyway, but this avoids the attempt). */
export function isAlertSoundUnlocked(): boolean {
  return unlocked;
}

// One tone: a sine oscillator through a gain node ramped in/out (never a hard
// on/off, which clicks), starting `startOffsetSec` after `context.currentTime`.
function playTone(context: AudioContext, freqHz: number, startOffsetSec: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = freqHz;
  osc.connect(gain);
  gain.connect(context.destination);

  const start = context.currentTime + startOffsetSec;
  const durationSec = TONE_DURATION_MS / 1000;
  const rampSec = RAMP_MS / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(PING_GAIN, start + rampSec);
  gain.gain.linearRampToValueAtTime(PING_GAIN, start + durationSec - rampSec);
  gain.gain.linearRampToValueAtTime(0, start + durationSec);
  osc.start(start);
  osc.stop(start + durationSec);
}

/** Plays the synthesized two-tone ping (880Hz then 1175Hz). A no-op whenever
 * sound is locked or Web Audio is unavailable — never throws, never breaks
 * the caller's own flow. */
export function playAlertPing(): void {
  if (!unlocked || !ctx) return;
  try {
    playTone(ctx, TONE_ONE_HZ, 0);
    playTone(ctx, TONE_TWO_HZ, TONE_GAP_SEC);
  } catch {
    // Audio failure must never break the app.
  }
}
