"use client";

import { useEffect, useState } from "react";
import { Settings, Volume2, VolumeX } from "lucide-react";

import { useTokenBoard } from "@/hooks/use-tokens";
import { useTokenRealtime } from "@/hooks/use-realtime";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useNowServingSound } from "@/hooks/use-now-serving-sound";
import { voiceNoticeOf } from "@/lib/now-serving-announcer";
import {
  NOW_SERVING_PREFS_DEFAULTS,
  readNowServingPrefs,
  writeNowServingPrefs,
  type NowServingPrefs,
} from "@/lib/now-serving-prefs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { KitchenFreshnessChip } from "@/components/kitchen/KitchenFreshnessChip";
import { NowServingBoard } from "@/components/now-serving/NowServingBoard";
import { SoundPanel } from "@/components/now-serving/SoundPanel";

// Print customization S9 — the Now Serving screen: the token numbers for customers (Preparing / Ready) with a chime
// and a spoken call when a token turns Ready. Open to any signed-in account like Kitchen, and like Kitchen it
// reads only (GET /api/tokens: numbers and times, never a name or an amount) — it never writes a token.
// `wide`: a TV must not lose width to the 1440px cap.
export default function NowServingPage() {
  return (
    <MenuPageShell wide>
      <NowServing />
    </MenuPageShell>
  );
}

function NowServing() {
  // A wall screen is never the focused tab: poll in the background. One realtime nudge refetches early; the poll
  // stays the fallback. The wake lock keeps the display awake while this tab is visible.
  const q = useTokenBoard({ enabled: true, background: true });
  useTokenRealtime();
  useWakeLock(true);

  // Defaults first, the stored choice after mount: no server/client mismatch.
  const [prefs, setPrefs] = useState<NowServingPrefs>(NOW_SERVING_PREFS_DEFAULTS);
  useEffect(() => {
    setPrefs(readNowServingPrefs());
  }, []);
  const changePrefs = (next: NowServingPrefs) => {
    setPrefs(next);
    writeNowServingPrefs(next);
  };

  const sound = useNowServingSound({ board: q.data, prefs });
  // Owner (s83): the sound settings open ONLY from the settings button — the main screen shows the board alone.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tokensOn = q.data?.enabled !== false;
  const SoundIcon = sound.soundOn ? Volume2 : VolumeX;

  return (
    <>
      <PageHeader
        eyebrow="Service"
        title="Now Serving"
        description="Token numbers for your customers. Ready tokens are called out loud."
        actions={
          <div className="flex items-center gap-2">
            <KitchenFreshnessChip dataUpdatedAt={q.dataUpdatedAt} />
            {tokensOn && (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 px-3"
                aria-label={sound.soundOn ? "Sound settings" : "Sound settings (sound is off)"}
                aria-haspopup="dialog"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings aria-hidden />
                <SoundIcon aria-hidden />
              </Button>
            )}
          </div>
        }
      />

      {tokensOn && (
        <SoundPanel
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          soundOn={sound.soundOn}
          failed={sound.unlockFailed}
          prefs={prefs}
          onPrefsChange={changePrefs}
          onTurnOn={sound.turnOnSound}
          notice={voiceNoticeOf(sound.voiceStatus, prefs.language, prefs.voice)}
        />
      )}

      <NowServingBoard board={q.data} isError={q.isError} onRetry={() => void q.refetch()} />
    </>
  );
}
