import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { NOW_SERVING_LANGUAGES, type NowServingLanguage } from "@/lib/now-serving-announcer";
import type { NowServingPrefs } from "@/lib/now-serving-prefs";

// Print customization S9 — the Now Serving sound settings, a pop-up opened ONLY from the header's settings button
// (owner, s83: the main screen shows the board alone; nothing opens by itself). It says whether sound is on, turns it
// on, and holds this device's voice choices. Any tap on the page still turns sound on (use-now-serving-sound).
const TOUCH_CLASS = "min-h-11";
const LANGUAGE_LABELS: Record<NowServingLanguage, string> = { en: "English", hi: "Hindi" };
const SWITCH_ID = "now-serving-say-number";
const TITLE = "Sound settings";
const DESCRIPTION = "This screen plays a chime and says the number when a token is ready.";

interface SoundPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundOn: boolean;
  /** The last try to turn sound on did not take. */
  failed: boolean;
  prefs: NowServingPrefs;
  onPrefsChange: (next: NowServingPrefs) => void;
  onTurnOn: () => void;
  /** voiceNoticeOf(...): why the voice cannot speak on this device, or null. */
  notice: string | null;
}

export function SoundPanel({ open, onOpenChange, soundOn, failed, prefs, onPrefsChange, onTurnOn, notice }: SoundPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <p className="text-sm font-medium">{soundOn ? "Sound is on." : "Sound is off."}</p>
          {failed && !soundOn && (
            <p role="alert" className="text-sm text-brand-danger">
              Sound did not start. Tap again.
            </p>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Voice</span>
            {NOW_SERVING_LANGUAGES.map((language) => (
              <Button
                key={language}
                type="button"
                variant={prefs.language === language ? "default" : "outline"}
                className={TOUCH_CLASS}
                aria-pressed={prefs.language === language}
                onClick={() => onPrefsChange({ ...prefs, language })}
              >
                {LANGUAGE_LABELS[language]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={SWITCH_ID}
              checked={prefs.voice}
              onCheckedChange={(voice) => onPrefsChange({ ...prefs, voice })}
            />
            <label htmlFor={SWITCH_ID} className="flex min-h-11 items-center text-sm">
              Say the number out loud
            </label>
          </div>
          {notice && <p className="text-sm text-brand-muted">{notice}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!soundOn && (
              <Button type="button" className={TOUCH_CLASS} onClick={onTurnOn}>
                Turn on sound
              </Button>
            )}
            <Button type="button" variant="outline" className={TOUCH_CLASS} onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
