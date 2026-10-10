"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAlertSoundUnlocked, playAlertPing, unlockAlertSound } from "@/lib/alert-sound";
import {
  announcementText,
  enqueueAnnouncements,
  INITIAL_ANNOUNCER_STATE,
  observeBoard,
  pickVoice,
  pruneQueue,
  type Announcement,
  type AnnouncerState,
  type VoiceStatus,
} from "@/lib/now-serving-announcer";
import type { NowServingPrefs } from "@/lib/now-serving-prefs";
import type { TokenBoard } from "@/lib/token-view";

// Print customization S9 — the Now Serving screen's sound: a chime, then the number spoken in the chosen language.
// The decisions (what is new, what to say, which voice) are pure and live in lib/now-serving-announcer.ts; this hook
// owns the browser: the shared alert AudioContext (lib/alert-sound.ts, never a second one), speechSynthesis, and the
// one serial player that never speaks two tokens at once.
const CHIME_SETTLE_MS = 400; // the ping is ~270 ms long: let it finish before the voice starts
const SPEAK_TIMEOUT_MS = 6000; // a stuck utterance is cancelled so the queue never freezes
const ANNOUNCE_GAP_MS = 800; // a breath between two tokens
const VOICES_WAIT_MS = 3000; // getVoices() fills late; no voice after this long = "missing"
const VOICES_POLL_MS = 250; // re-read getVoices() on a beat too: the voiceschanged event alone is not reliable
const SOUND_UNLOCK_SETTLE_MS = 300; // AudioContext.resume() settles asynchronously...
const SOUND_UNLOCK_TRIES = 5; // ...and a waking speaker can take longer: re-check a few times before "did not start"
const SPEECH_RATE = 0.9; // a little slower than normal: a hall is noisy
const ANNOUNCE_REPEAT = 1; // owner answer: each token is called once
const PRIME_TEXT = " "; // silent priming utterance (WebKit only lets the first speak() start inside a gesture)
const PRIME_VOLUME = 0;

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
}

interface UseNowServingSoundInput {
  board: TokenBoard | undefined;
  prefs: NowServingPrefs;
}

export interface NowServingSound {
  soundOn: boolean;
  unlockFailed: boolean;
  voiceStatus: VoiceStatus;
  turnOnSound: () => void;
}

export function useNowServingSound({ board, prefs }: UseNowServingSoundInput): NowServingSound {
  const [soundOn, setSoundOn] = useState(false);
  const [unlockFailed, setUnlockFailed] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("checking");

  const prefsRef = useRef(prefs);
  const soundOnRef = useRef(false);
  // Speech primed by a gesture on THIS page: the shell's first-tap unlock (PosPulseProvider) can start the chime before
  // mount, but WebKit drops speak() until one starts in a gesture here — sound is on only after both (or no speech).
  const primedRef = useRef(false);
  // The board cached when this page mounted (an earlier visit's, or the top-bar sheet's). It and its optimistic
  // copies keep that server stamp, so they are never observed: only a board fetched on THIS visit seeds the announcer.
  const initialGeneratedAtRef = useRef(board?.generatedAt);
  const voiceStatusRef = useRef<VoiceStatus>("checking");
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const announcerRef = useRef<AnnouncerState>(INITIAL_ANNOUNCER_STATE);
  const queueRef = useRef<Announcement[]>([]);
  const playingRef = useRef(false);
  const aliveRef = useRef(false);
  const settlingRef = useRef(false);
  // The utterance being spoken: held here until it ends, errors or times out (it can be collected mid-speech).
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Everything waiting on a timer or an event, so unmount can release it all at once.
  const flushersRef = useRef(new Set<() => void>());

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const updateVoiceStatus = useCallback((status: VoiceStatus) => {
    voiceStatusRef.current = status;
    setVoiceStatus(status);
  }, []);

  const applySoundOn = useCallback((on: boolean) => {
    soundOnRef.current = on;
    setSoundOn(on);
    if (on) setUnlockFailed(false);
  }, []);

  const audible = useCallback(() => isAlertSoundUnlocked() && (primedRef.current || !speechSupported()), []);

  const later = useCallback((fn: () => void, ms: number) => {
    const flush = () => clearTimeout(timer);
    const timer = setTimeout(() => {
      flushersRef.current.delete(flush);
      fn();
    }, ms);
    flushersRef.current.add(flush);
  }, []);

  const sleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const flush = () => {
        clearTimeout(timer);
        flushersRef.current.delete(flush);
        resolve();
      };
      const timer = setTimeout(flush, ms);
      flushersRef.current.add(flush);
    });
  }, []);

  // One utterance, settled by end / error / SPEAK_TIMEOUT_MS (a timeout cancels the speech).
  const speakOnce = useCallback((text: string, voice: SpeechSynthesisVoice, rate: number) => {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      utteranceRef.current = utterance;
      const settle = () => {
        clearTimeout(timer);
        utterance.removeEventListener("end", settle);
        utterance.removeEventListener("error", settle);
        flushersRef.current.delete(settle);
        if (utteranceRef.current === utterance) utteranceRef.current = null;
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Nothing to cancel.
        }
        settle();
      }, SPEAK_TIMEOUT_MS);
      utterance.addEventListener("end", settle);
      utterance.addEventListener("error", settle);
      flushersRef.current.add(settle);
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        settle();
      }
    });
  }, []);

  // The ONE player: a chime, then the voice, then a gap — per queued token, strictly one after another.
  const runPlayer = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    try {
      while (aliveRef.current && queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (!item) break;
        if (isAlertSoundUnlocked()) {
          playAlertPing();
          await sleep(CHIME_SETTLE_MS);
          if (!aliveRef.current) break;
        }
        const current = prefsRef.current;
        const voice = voiceRef.current;
        if (current.voice && voiceStatusRef.current === "ready" && voice && speechSupported()) {
          for (let i = 0; i < ANNOUNCE_REPEAT && aliveRef.current; i++) {
            await speakOnce(announcementText(item.number, current.language), voice, SPEECH_RATE);
          }
        }
        if (!aliveRef.current) break;
        await sleep(ANNOUNCE_GAP_MS);
      }
    } finally {
      playingRef.current = false;
    }
  }, [sleep, speakOnce]);

  // Mount: alive for the page's life; one best-effort unlock (it works where sound may play without a gesture, e.g. the
  // POS app's WebView, which cannot speak anyway) + a settle check. Cleanup releases every timer/listener, stops speech.
  useEffect(() => {
    aliveRef.current = true;
    settlingRef.current = false;
    const flushers = flushersRef.current;
    unlockAlertSound();
    later(() => {
      if (audible()) applySoundOn(true);
    }, SOUND_UNLOCK_SETTLE_MS);
    return () => {
      aliveRef.current = false;
      queueRef.current = [];
      for (const flush of Array.from(flushers)) flush();
      flushers.clear();
      utteranceRef.current = null;
      if (speechSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Nothing to cancel.
        }
      }
    };
  }, [later, applySoundOn, audible]);

  // Voices: getVoices() starts empty and fills late, so read on the voiceschanged event AND on a short beat until
  // VOICES_WAIT_MS; then no voice = "missing" (a later arrival still flips it to "ready"). Re-picked per language.
  useEffect(() => {
    voiceRef.current = null;
    if (!speechSupported()) {
      updateVoiceStatus("unsupported");
      return;
    }
    updateVoiceStatus("checking");
    const synth = window.speechSynthesis;
    const language = prefs.language;
    let waitOver = false;
    const read = () => {
      const voice = pickVoice(synth.getVoices(), language);
      voiceRef.current = voice;
      if (voice) updateVoiceStatus("ready");
      else updateVoiceStatus(waitOver ? "missing" : "checking");
    };
    read();
    const beat = setInterval(read, VOICES_POLL_MS);
    const stopBeat = setTimeout(() => {
      waitOver = true;
      clearInterval(beat);
      read();
    }, VOICES_WAIT_MS);
    synth.addEventListener("voiceschanged", read);
    return () => {
      clearInterval(beat);
      clearTimeout(stopBeat);
      synth.removeEventListener("voiceschanged", read);
    };
  }, [prefs.language, updateVoiceStatus]);

  // Call ONLY from a gesture handler: unlock the shared AudioContext and prime speech inside the gesture, then check
  // (a few times — resume() can be slow) that it took. A confirmation ping plays only when this tap turned sound on.
  const turnOnSound = useCallback(() => {
    unlockAlertSound();
    if (speechSupported()) {
      try {
        const prime = new SpeechSynthesisUtterance(PRIME_TEXT);
        prime.volume = PRIME_VOLUME;
        window.speechSynthesis.speak(prime);
        primedRef.current = true;
      } catch {
        // Speech priming is best effort: the chime still works.
      }
    }
    if (settlingRef.current) return;
    settlingRef.current = true;
    const check = (triesLeft: number) =>
      later(() => {
        if (!aliveRef.current) return;
        const on = audible();
        if (!on && triesLeft > 1) return check(triesLeft - 1);
        settlingRef.current = false;
        const flipped = on && !soundOnRef.current;
        applySoundOn(on);
        setUnlockFailed(!on);
        if (flipped) playAlertPing();
      }, SOUND_UNLOCK_SETTLE_MS);
    check(SOUND_UNLOCK_TRIES);
  }, [later, applySoundOn, audible]);

  // While sound is off, ANY tap or key on the page turns it on (the card button is just one such tap). `click`, not
  // pointerdown: a touch pointerdown is not a user activation, a click is (for mouse and touch alike).
  useEffect(() => {
    if (soundOn) return;
    const onGesture = () => turnOnSound();
    window.addEventListener("click", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      window.removeEventListener("click", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
  }, [soundOn, turnOnSound]);

  // Observe each new server board (never the one cached at mount, nor its optimistic copies). While sound is off the
  // announcer state still advances but the calls are dropped, so turning sound on never replays a backlog.
  const generatedAt = board?.generatedAt;
  useEffect(() => {
    if (!board || board.generatedAt === initialGeneratedAtRef.current) return;
    const { state, announce } = observeBoard(announcerRef.current, board);
    announcerRef.current = state;
    if (!soundOnRef.current && audible()) applySoundOn(true); // a slow resume() that settled after the last check
    if (!soundOnRef.current) {
      queueRef.current = [];
      return;
    }
    queueRef.current = pruneQueue(enqueueAnnouncements(queueRef.current, announce), board);
    void runPlayer();
    // Keyed on generatedAt (a board is observed once per server snapshot); `board` is read from the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedAt, runPlayer, audible, applySoundOn]);

  return { soundOn, unlockFailed, voiceStatus, turnOnSound };
}
