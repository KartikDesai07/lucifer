"use client";

import { useState } from "react";

import {
  PUBLIC_MOBILE_MAX_LEN,
  PUBLIC_MOBILE_PATTERN,
  PUBLIC_NAME_MAX_LEN,
} from "@pos/shared/public";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearIdentity } from "@/components/public/public-cart-store";

interface PublicIdentityFormProps {
  mobile: string;
  name: string;
  onMobileChange: (value: string) => void;
  onNameChange: (value: string) => void;
  // True once the diner has tapped the primary submit button at least once —
  // forces both errors visible even for a field never individually touched
  // (e.g. name left blank and never focused). PublicCart owns this and the
  // actual valid/invalid check (same PUBLIC_MOBILE_PATTERN) for its button.
  submitted: boolean;
}

// The diner's name + mobile, collected right before submit. Prefilled by the
// parent from readIdentity() (public-cart-store.ts) so a returning diner on
// the same phone never retypes it. Plain controlled inputs, not RHF — this
// form is two fields and RHF would be pure overhead here.
//
// §10.1: this form NEVER makes a server round trip to check anything —
// whether a number is already known to this cafe must never be observable
// from the client, so validation here is shape-only, against the SAME
// PUBLIC_MOBILE_PATTERN the route re-checks server-side.
export function PublicIdentityForm({
  mobile,
  name,
  onMobileChange,
  onNameChange,
  submitted,
}: PublicIdentityFormProps) {
  const [touchedMobile, setTouchedMobile] = useState(false);
  const [touchedName, setTouchedName] = useState(false);

  const mobileValid = PUBLIC_MOBILE_PATTERN.test(mobile.trim());
  const nameValid = name.trim().length > 0;
  const showMobileError = (touchedMobile || submitted) && !mobileValid;
  const showNameError = (touchedName || submitted) && !nameValid;

  // FIX5 — wipes the stored identity AND empties both live fields, for a
  // shared device (or a diner who typed the wrong number) to start clean.
  function handleClear() {
    clearIdentity();
    onMobileChange("");
    onNameChange("");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Your details</span>
        {(mobile.trim().length > 0 || name.trim().length > 0) && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Not you? Clear
          </button>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="public-identity-mobile">Mobile number</Label>
        <Input
          id="public-identity-mobile"
          type="text"
          inputMode="tel"
          className="text-base"
          maxLength={PUBLIC_MOBILE_MAX_LEN}
          value={mobile}
          onChange={(e) => onMobileChange(e.target.value)}
          onBlur={() => setTouchedMobile(true)}
          aria-invalid={showMobileError}
          placeholder="10-digit mobile number"
        />
        {showMobileError && (
          <p className="text-xs text-destructive">Enter a valid mobile number.</p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="public-identity-name">Your name</Label>
        <Input
          id="public-identity-name"
          type="text"
          className="text-base"
          maxLength={PUBLIC_NAME_MAX_LEN}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={() => setTouchedName(true)}
          aria-invalid={showNameError}
          placeholder="Your name"
        />
        {showNameError && <p className="text-xs text-destructive">Enter your name.</p>}
      </div>
      {/* Field-feedback 2026-08-20: diners hesitate to type their number — say
          out loud what it is (and is not) used for. Shape-only reassurance; the
          §10 guarantees behind it are real (never shown publicly, no lookups). */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Kept private — used only to update you about this order. Never shown
        publicly, never shared.
      </p>
    </div>
  );
}
