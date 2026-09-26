"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, UtensilsCrossed } from "lucide-react";

import { clearMastersBlob } from "@/lib/masters-blob";
import { loginSchema, type LoginInput } from "@/schemas/staff.schema";
import { APP_NAME } from "@/lib/constants";
import { brandingUrl } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  BRAND_BUTTON_CLASS,
  BRAND_FIELD_ERROR_CLASS,
  BRAND_INPUT_CLASS,
  BRAND_LABEL_CLASS,
} from "@/components/brand/brand-classes";

// Staff sign-in. The screen's FRAME (greeting, painting, logo lockup, responsive
// layout) lives in components/auth/AuthShell and its styles in
// components/brand; this file keeps everything that decides whether sign-in
// works — the form, the credentials call, the shared-device wipe, the
// masked-by-default password and the logo's failure fallback.

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

  // A tab that reaches /login (expired session, or a sign-out) must not hand
  // the previous operator's master copy — including an admin's staff list — to
  // whoever signs in next on this shared device.
  useEffect(() => {
    clearMastersBlob();
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: LoginInput) => {
    setAuthError(null);
    const result = await signIn("credentials", { ...values, redirect: false });

    if (!result || result.error) {
      setAuthError("Invalid username or password");
      return;
    }

    // Land on the dashboard; refresh so the server picks up the new session.
    router.replace("/");
    router.refresh();
  };

  // One element, handed to the shell for its logo slot. It takes the slot's
  // height and its OWN width (a wide wordmark reads at its real size, not
  // shrunk into a square); multiply lets a logo saved on a white background
  // sit on the card's paper without a white box. The fallback glyph takes
  // over if the image fails. No coloured tile behind either — an icon in a
  // filled square is the stock template look this screen is built to avoid.
  const logo = iconFailed ? (
    <UtensilsCrossed className="h-6 w-6 text-brand-ink" aria-hidden="true" />
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

  return (
    <AuthShell
      brandName={APP_NAME}
      logo={logo}
      title="Welcome back."
      intro={`Sign in to continue to ${APP_NAME}.`}
      footer="Forgot your password? Ask an admin to reset it."
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
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
    </AuthShell>
  );
}
