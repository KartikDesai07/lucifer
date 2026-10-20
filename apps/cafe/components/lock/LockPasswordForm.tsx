"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

import { signInWithPassword, type PasswordSignInAnswer } from "@/lib/pin-sign-in-client";
import { loginSchema, type LoginInput } from "@/schemas/staff.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  AUTH_ALERT_CLASS,
  AUTH_BUTTON_CLASS,
  AUTH_FIELD_ERROR_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LABEL_CLASS,
  AUTH_LINK_CLASS,
  AUTH_REVEAL_CLASS,
} from "@/components/auth/auth-classes";

// The lock screen's username and password sign-in (spec 2026-10-16 §5.6): for a person without a PIN, a device that
// remembers nobody, or a session from before this release. The login form's fields and labels with the lock's own
// ids (the login page and the lock never share a document, but the ids say which form a test or a reader means). It
// runs in place through signInWithPassword, which can never navigate the dashboard away, so printing goes on; the
// caller decides what a success means (the same person, or a switch). It sits in the lock's card in the owner's HTML
// form style (U0 match Task 10, design 5.6, ruling R31: components/auth/auth-classes).

type PasswordFailure = Extract<PasswordSignInAnswer, { ok: false }>["failure"];

/** Password-neutral copy (ruling R14): the PIN pad's own wording would talk about a PIN here. */
export function lockPasswordMessage(failure: PasswordFailure): string {
  if (failure.kind === "credentials") return "Invalid username or password";
  if (failure.kind === "offline") return "No internet. Sign-in can't be checked right now. Printing goes on.";
  return "Couldn't sign in just now. Please try again.";
}

interface LockPasswordFormProps {
  /** The person signed in under the lock ("Signed in as Asha Rao"); the session carries no username to pre-fill. */
  signedInAs: string | null;
  onSignedIn(): void | Promise<void>;
  /** Back to the name tiles; left out when this device remembers nobody with a PIN. */
  onUsePin?: () => void;
}

export function LockPasswordForm({ signedInAs, onSignedIn, onUsePin }: LockPasswordFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  // Masked by default and never remembered: the next person at a shared counter starts hidden.
  const [passwordShown, setPasswordShown] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: LoginInput) => {
    setMessage(null);
    const answer = await signInWithPassword(values.username, values.password);
    if (!answer.ok) {
      setMessage(lockPasswordMessage(answer.failure));
      return;
    }
    try {
      await onSignedIn();
    } catch {
      setMessage(lockPasswordMessage({ kind: "error" }));
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm">
      {signedInAs && (
        <p className="mb-5 text-center text-[14px] text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{signedInAs}</span>
        </p>
      )}
      {/* method="post" like the login form: a submit that ever lands without the handler never GETs the password
          into the URL. */}
      <form method="post" className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="space-y-2">
          <Label htmlFor="lock-username" className={AUTH_LABEL_CLASS}>
            Username
          </Label>
          <Input
            id="lock-username"
            placeholder="Your username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!errors.username}
            className={AUTH_INPUT_CLASS}
            {...register("username")}
          />
          {errors.username && <p className={AUTH_FIELD_ERROR_CLASS}>{errors.username.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lock-password" className={AUTH_LABEL_CLASS}>
            Password
          </Label>
          <div className="relative">
            <Input
              id="lock-password"
              type={passwordShown ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              className={`${AUTH_INPUT_CLASS} pr-11`}
              {...register("password")}
            />
            {/* type="button" is load-bearing: a bare <button> inside a <form> submits. */}
            <button
              type="button"
              onClick={() => setPasswordShown((shown) => !shown)}
              aria-label={passwordShown ? "Hide password" : "Show password"}
              aria-pressed={passwordShown}
              className={AUTH_REVEAL_CLASS}
            >
              {passwordShown ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && <p className={AUTH_FIELD_ERROR_CLASS}>{errors.password.message}</p>}
        </div>

        {message && (
          <div role="alert" className={AUTH_ALERT_CLASS}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}

        <Button type="submit" className={AUTH_BUTTON_CLASS} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </>
          )}
        </Button>
      </form>

      {onUsePin && (
        <button type="button" data-ui="lock-use-pin" onClick={onUsePin} className={cn(AUTH_LINK_CLASS, "mx-auto mt-3 flex")}>
          Sign in with PIN
        </button>
      )}
    </div>
  );
}
