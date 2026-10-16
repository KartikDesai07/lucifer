"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, UtensilsCrossed } from "lucide-react";

import { clearMastersBlob } from "@/lib/masters-blob";
import { fetchKnownPeople, rememberThisDevice, type KnownPerson } from "@/lib/pin-sign-in-client";
import { clearLockState } from "@/lib/screen-lock";
import { loginSchema, type LoginInput } from "@/schemas/staff.schema";
import { APP_NAME } from "@/lib/constants";
import { brandingUrl } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthShell } from "@/components/auth/AuthShell";
import { PinSignIn } from "@/components/auth/PinSignIn";
import {
  BRAND_BUTTON_CLASS,
  BRAND_FIELD_ERROR_CLASS,
  BRAND_INPUT_CLASS,
  BRAND_LABEL_CLASS,
} from "@/components/brand/brand-classes";

// Staff sign-in. The screen's FRAME (header, card, "Powered by") lives in components/auth/AuthShell and the name
// tiles + PIN pad in components/auth/PinSignIn; this file keeps everything that decides whether sign-in works: which
// way in this device offers, the form, the credentials call, the shared-device wipe, the masked-by-default password,
// the device memory after a sign-in and the logo's failure fallback.

// "loading" until the device's remembered people are known (one neutral card, no flash of either form); then the
// tiles when there is anyone to pick, else the username and password form (spec 2026-10-16 §5.3).
type LoginMode = "loading" | "pin" | "password";

export default function LoginPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);
  // The login screen has no session, so it cannot fetch Settings for the
  // product logo ref — /api/branding/[slot] is public precisely so this
  // unauthenticated page can still render an image.
  const productLogoSrc = brandingUrl("productLogo");
  // The login screen is the one surface an operator cannot navigate away
  // from a broken image on, and this route can legitimately fail (e.g. the
  // database is down) — fall back to the generic icon tile if it does.
  const [iconFailed, setIconFailed] = useState(false);
  // Reveal-while-typing for the password. Defaults to hidden and is never
  // persisted: a counter PC is a SHARED screen, so the next operator must
  // always start from a masked field, whatever the last one left on.
  const [passwordShown, setPasswordShown] = useState(false);
  const [mode, setMode] = useState<LoginMode>("loading");
  const [people, setPeople] = useState<KnownPerson[]>([]);

  // A tab that reaches /login (expired session, or a sign-out) must not hand
  // the previous operator's master copy — including an admin's staff list — to
  // whoever signs in next on this shared device.
  useEffect(() => {
    clearMastersBlob();
  }, []);

  // One look-up per page load: who this device remembers with a PIN (any failure reads as nobody).
  useEffect(() => {
    let live = true;
    void fetchKnownPeople().then((known) => {
      if (!live) return;
      setPeople(known);
      setMode(known.length > 0 ? "pin" : "password");
    });
    return () => {
      live = false;
    };
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  // Both ways in end here: the device remembers the signed-in person (it needs the new session, so it runs after the
  // sign-in, once), then the dashboard; refresh so the server picks up the new session. A screen lock left stored on
  // this device (a sign-out from the lock, a session that ran out while locked) goes first: a fresh sign-in never
  // lands on a stale lock screen (ruling R15).
  const finishSignIn = async () => {
    try {
      clearLockState(window.localStorage);
    } catch {
      // Storage itself can be blocked; then nothing was stored either.
    }
    await rememberThisDevice();
    router.replace("/");
    router.refresh();
  };

  const onSubmit = async (values: LoginInput) => {
    setAuthError(null);
    const result = await signIn("credentials", { ...values, redirect: false });

    if (!result || result.error) {
      setAuthError("Invalid username or password");
      return;
    }

    await finishSignIn();
  };

  // Back to the tiles: the form starts empty and masked again next time it opens.
  const showPinSignIn = () => {
    reset();
    setPasswordShown(false);
    setAuthError(null);
    setMode("pin");
  };

  // One element, handed to the shell for its logo tile. It takes the tile's
  // height and its OWN width (a wide wordmark reads at its real size, not
  // shrunk into a square); multiply lets a logo saved on a white background
  // sit on the white tile without a box of its own. The fallback glyph takes
  // over if the image fails.
  const logo = iconFailed ? (
    <UtensilsCrossed className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
  ) : (
    <Image
      src={productLogoSrc}
      alt={APP_NAME}
      width={48}
      height={48}
      unoptimized
      className="h-full w-auto max-w-full object-contain mix-blend-multiply"
      onError={() => setIconFailed(true)}
    />
  );

  const passwordMode = mode === "password";

  return (
    <AuthShell
      brandName={APP_NAME}
      logo={logo}
      title={passwordMode ? "Welcome back." : undefined}
      intro={passwordMode ? `Sign in to continue to ${APP_NAME}.` : undefined}
      footer={passwordMode ? "Forgot your password? Ask an admin to reset it." : undefined}
    >
      {mode === "loading" && (
        <div role="status" aria-label="Loading sign-in" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="mt-3 h-[150px] w-full md:h-[160px]" />
        </div>
      )}

      {mode === "pin" && (
        <PinSignIn people={people} onUsePassword={() => setMode("password")} onSignedIn={finishSignIn} />
      )}

      {passwordMode && (
        <div className="mx-auto w-full max-w-sm">
          {/* method="post": a submit that lands before hydration (slow network,
              quick typist) is a NATIVE form submit — without this the browser
              GETs /login?username=…&password=… and the password lands in the
              URL, the history and the request logs. */}
          <form method="post" className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="username" className={BRAND_LABEL_CLASS}>
                Username
              </Label>
              <Input
                id="username"
                placeholder="Your username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!errors.username}
                className={BRAND_INPUT_CLASS}
                {...register("username")}
              />
              {errors.username && (
                <p className={BRAND_FIELD_ERROR_CLASS}>{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className={BRAND_LABEL_CLASS}>
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={passwordShown ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  className={`${BRAND_INPUT_CLASS} pr-12`}
                  {...register("password")}
                />
                {/* Inside the field's own box (pr-12 keeps the text clear of
                    it) so the form layout is unchanged. type="button" is
                    load-bearing: a bare <button> inside a <form> submits. */}
                <button
                  type="button"
                  onClick={() => setPasswordShown((shown) => !shown)}
                  aria-label={passwordShown ? "Hide password" : "Show password"}
                  aria-pressed={passwordShown}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-md text-brand-muted hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  {passwordShown ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className={BRAND_FIELD_ERROR_CLASS}>{errors.password.message}</p>
              )}
            </div>

            {authError && (
              // Icon + text, never colour alone; role="alert" so a screen reader
              // announces a failed attempt without the operator hunting for it.
              // The one-off shake replays on EVERY failure: onSubmit clears the
              // error before the network call, so each failed attempt mounts this
              // box afresh.
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-brand-danger/25 bg-brand-danger/5 px-3 py-2.5 text-sm text-brand-danger motion-safe:animate-brand-shake"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{authError}</span>
              </div>
            )}

            <Button type="submit" className={BRAND_BUTTON_CLASS} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  {/* A small forward nudge on hover — the one bit of motion on
                      the screen, and it points at what happens next. */}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </Button>
          </form>

          {people.length > 0 && (
            <button
              type="button"
              onClick={showPinSignIn}
              className="mx-auto mt-3 flex h-11 items-center rounded-md px-2 text-[13.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in with PIN
            </button>
          )}
        </div>
      )}
    </AuthShell>
  );
}
