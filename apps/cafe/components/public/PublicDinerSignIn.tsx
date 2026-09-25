"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

import { PUBLIC_MOBILE_PATTERN } from "@pos/shared/public";
import { DINER_PIN_LENGTH, isValidDinerPin } from "@pos/shared/public-diner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PUBLIC_TOUCH_TARGET_CLASS,
  PUBLIC_TOUCH_TEXT_CLASS,
} from "@/components/public/public-shell-layout";
import { PUB_TINT_CLASS } from "@/components/public/public-ui";
import { cn } from "@/lib/utils";

// CB-4 — the diner's sign-in / first-PIN form. Two fields, no OTP, no email,
// no password rules to read: the entire flow is "your mobile number, and four
// digits you choose".

const LOGIN_ENDPOINT = "/api/public/diner/login";
const SET_PIN_ENDPOINT = "/api/public/diner/pin";

const GENERIC_ERROR = "Couldn't sign you in — please try again.";
const OFFLINE_ERROR = "You look offline — check the cafe WiFi and try again.";
const MOBILE_SHAPE_ERROR = "Enter the 10-digit mobile number you give at the counter.";
const PIN_SHAPE_ERROR = `Your PIN must be exactly ${DINER_PIN_LENGTH} digits.`;

type Mode = "signin" | "create";

interface PublicDinerSignInProps {
  onSignedIn: (diner: { name: string; mobile: string }) => void;
}

export function PublicDinerSignIn({ onSignedIn }: PublicDinerSignInProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!PUBLIC_MOBILE_PATTERN.test(mobile.trim())) {
      setError(MOBILE_SHAPE_ERROR);
      return;
    }
    if (!isValidDinerPin(pin)) {
      setError(PIN_SHAPE_ERROR);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(mode === "signin" ? LOGIN_ENDPOINT : SET_PIN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobile.trim(), pin, ...(mode === "create" ? { name: name.trim() } : {}) }),
      });
      const envelope = (await res.json().catch(() => null)) as
        | { success: true; data: { name: string; mobile: string } }
        | { success: false; error: string }
        | null;
      if (res.ok && envelope?.success) {
        onSignedIn(envelope.data);
        return;
      }
      // The server's own message is shown verbatim: it is deliberately the
      // SAME text for a wrong PIN and an unknown mobile (an enumeration
      // oracle otherwise), and it carries the real reason for a rate limit or
      // a weak PIN. Never second-guess it here.
      setError(envelope && !envelope.success ? envelope.error : GENERIC_ERROR);
    } catch {
      setError(OFFLINE_ERROR);
    } finally {
      // Unlike the cart's submit (which navigates away), this form stays
      // mounted on success, so the button must always be re-enabled.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-pub-gap p-pub-pad">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={cn(PUB_TINT_CLASS, "grid h-12 w-12 shrink-0 place-items-center rounded-full")}>
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="font-pub-display text-lg font-semibold">
          {mode === "signin" ? "Sign in" : "Set your PIN"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === "signin"
            ? "Use the mobile number you give at the counter."
            : // CB-4 / owner-reported 2026-09-16: says UP FRONT that the number
              // must already be known to the cafe. A Customer row is minted
              // only when staff accept or settle an order, so a brand-new
              // number cannot hold a PIN yet — and without this line the first
              // a diner heard of it was a refusal after typing everything in.
              `Use the mobile number you have ordered with here before. Choose ${DINER_PIN_LENGTH} digits you'll remember — staff can reset it for you at the counter.`}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="diner-mobile">Mobile number</Label>
        <Input
          id="diner-mobile"
          // type=tel + inputMode=numeric: a real phone keypad, not a full
          // keyboard, on the cheap Android phones this surface targets.
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          className="h-12 text-lg"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
      </div>

      {mode === "create" && (
        <div className="space-y-1.5">
          <Label htmlFor="diner-name">Your name</Label>
          <Input id="diner-name" className="h-12 text-lg" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="diner-pin">{DINER_PIN_LENGTH}-digit PIN</Label>
        <Input
          id="diner-pin"
          type="password"
          inputMode="numeric"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          maxLength={DINER_PIN_LENGTH}
          className="h-12 text-center text-lg tracking-[0.5em]"
          value={pin}
          // Digits only, enforced as you type: the server rejects anything
          // else anyway, so silently dropping a stray character is kinder than
          // an error after submit.
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className={cn("w-full", PUBLIC_TOUCH_TARGET_CLASS)} onClick={submit} disabled={busy}>
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create my PIN"}
      </Button>

      <button
        type="button"
        className={cn(
          "w-full text-center text-sm text-muted-foreground underline",
          // The ONLY route a first-time diner has to "set a PIN" — it was a
          // ~20px text-height hit box before this.
          PUBLIC_TOUCH_TEXT_CLASS,
        )}
        onClick={() => {
          setMode(mode === "signin" ? "create" : "signin");
          setError(null);
        }}
      >
        {mode === "signin" ? "First time? Set a PIN" : "Already have a PIN? Sign in"}
      </button>
    </div>
  );
}
