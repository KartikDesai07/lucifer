"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { MASTERS_HOLD_MAX_MS } from "@/lib/bootstrap-contract";
import { askSession, startSessionReader, type SessionReader } from "@/lib/device-session";
import { ShellPlaceholder } from "@/components/layout/MasterDataProvider";

// The staff shell waits here for the session read on the device (lib/device-session.ts has the why): the frame is
// static, so no server session comes with it. Until the first answer the shell, the nav and every guard stay behind
// the same placeholder MasterDataProvider shows, so a staff member never sees an admin row and AdminGuard never runs
// on a session that is merely late. After MASTERS_HOLD_MAX_MS without an answer the placeholder says so and offers
// Retry, and keeps trying by itself (at most once a minute while the page is hidden).
//
// SessionProvider is mounted ONCE with the first session and never re-keyed: it reads its `session` prop only at
// mount, and a PIN switch or a password sign-in on the lock screen updates it through next-auth's own signIn. Its
// focus re-read (refetchOnWindowFocus) is left as it always was.
export function DeviceSessionGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [slow, setSlow] = useState(false);
  const reader = useRef<SessionReader | null>(null);

  useEffect(() => {
    const slowTimer = window.setTimeout(() => setSlow(true), MASTERS_HOLD_MAX_MS);
    const started = startSessionReader({
      ask: (signal) => askSession((input, init) => window.fetch(input, init), signal),
      onSession: (first) => {
        window.clearTimeout(slowTimer);
        setSession(first);
      },
      onSignedOut: () => {
        // A real sign-out: /login as a full page load (as the middleware would send it); the plain placeholder stays
        // until the browser leaves, never the shell and never the "Connecting" words.
        window.clearTimeout(slowTimer);
        setSlow(false);
        window.location.assign("/login");
      },
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (id) => window.clearTimeout(id),
      // While nobody can see the page the retries slow to once a minute (a free-tier cost during an outage), never
      // stop (a hidden print-host tab must come up by itself); the page showing asks at once.
      isHidden: () => document.visibilityState === "hidden",
      onVisible: (run) => {
        const onChange = () => {
          if (document.visibilityState === "visible") run();
        };
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
      },
    });
    reader.current = started;
    return () => {
      started.stop();
      reader.current = null;
      window.clearTimeout(slowTimer);
    };
  }, []);

  const retryNow = () => reader.current?.retryNow();

  if (session !== null) return <SessionProvider session={session}>{children}</SessionProvider>;
  if (slow) return <ShellPlaceholder message="Connecting to the server…" onRetry={retryNow} />;
  return <ShellPlaceholder />;
}
