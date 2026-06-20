import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Lucifer Cafe" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("Lucifer");
  const [password, setPassword] = useState("");

  // Allow username-only login by mapping it to an internal email domain.
  const toEmail = (v: string) => (v.includes("@") ? v.trim() : `${v.trim().toLowerCase()}@cafe.local`);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const mapped = toEmail(email);
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: mapped,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: mapped, password });
        if (error) throw error;
        toast.success("Welcome back!");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-sm p-6 space-y-5">
        <div className="text-center space-y-1">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center text-2xl">☕</div>
          <h1 className="text-xl font-bold">Lucifer Cafe</h1>
          <p className="text-xs text-muted-foreground">
            {mode === "signin" ? "Sign in to manage your café" : "Create your staff account"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>ID</Label>
            <Input type="text" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="Lucifer" />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>
      </Card>
    </div>
  );
}
