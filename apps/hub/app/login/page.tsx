"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

// F3.4 owner login: email + a TOTP code (no password — the Hub owner has none by
// design). On success Auth.js sets the session cookie; the panel gate takes over
// from there. The console UI itself is a later F3 step; this is the auth entry.
export default function HubLoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn("credentials", {
      email,
      code,
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      // Deliberately generic — no hint whether the email exists or the code was
      // the wrong part (the panel is the crown jewel).
      setError("Sign-in failed. Check your email and authenticator code.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="hub-login">
      <h1>Control Plane — Owner Sign-in</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="code">Authenticator code</label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Sign in"}
        </button>
      </form>
      {error ? <p className="hub-error">{error}</p> : null}
    </main>
  );
}
