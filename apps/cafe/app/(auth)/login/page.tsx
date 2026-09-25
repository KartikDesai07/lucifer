"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { Eye, EyeOff, Loader2, UtensilsCrossed } from "lucide-react";

import { clearMastersBlob } from "@/lib/masters-blob";
import { loginSchema, type LoginInput } from "@/schemas/staff.schema";
import { APP_NAME } from "@/lib/constants";
import { brandingUrl } from "@/lib/images";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 text-center">
          {iconFailed ? (
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
              <UtensilsCrossed className="h-6 w-6" />
            </div>
          ) : (
            // No bg-primary tile here — a transparent PNG shouldn't sit on a
            // coloured square the way the fallback glyph does.
            <Image
              src={productLogoSrc}
              alt={APP_NAME}
              width={48}
              height={48}
              unoptimized
              className="mx-auto mb-2 h-12 w-12 rounded-xl object-contain"
              onError={() => setIconFailed(true)}
            />
          )}
          <CardTitle className="text-xl">{APP_NAME}</CardTitle>
          <CardDescription>Sign in to the POS dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="admin"
                autoComplete="username"
                aria-invalid={!!errors.username}
                {...register("username")}
              />
              {errors.username && (
                <p className="text-xs text-destructive">{errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={passwordShown ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  className="pr-10"
                  {...register("password")}
                />
                {/* Inside the field's own box (pr-10 keeps the text clear of
                    it) so the form layout is unchanged. type="button" is
                    load-bearing: a bare <button> inside a <form> submits. */}
                <button
                  type="button"
                  onClick={() => setPasswordShown((shown) => !shown)}
                  aria-label={passwordShown ? "Hide password" : "Show password"}
                  aria-pressed={passwordShown}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {passwordShown ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {authError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                {authError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
