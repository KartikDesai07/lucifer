/**
 * Part D of the staff PIN live leg: the Screen lock setting (spec 2026-10-16 §5.6), through the REAL
 * /api/settings route handlers. An admin saves 30 and reads it back; 45 is refused with 400 and the stored
 * value stays 30.
 */
import type { Harness } from "./verify-staff-pin-live-helpers";

export async function runPartD(h: Harness): Promise<void> {
  const { check } = h;
  console.log("\n  Part D - the Screen lock setting (PUT /api/settings)");
  h.setRole("admin");

  const saved = await h.settings.update({ screenLockMinutes: 30 });
  check("PUT settings { screenLockMinutes: 30 } as admin -> 200", saved.status === 200, saved);

  const back = await h.settings.get();
  const readBack = (back.body.data as { screenLockMinutes?: unknown } | undefined)?.screenLockMinutes;
  check("GET settings reads screenLockMinutes back as 30", back.status === 200 && readBack === 30, back);

  const refused = await h.settings.update({ screenLockMinutes: 45 });
  check("PUT settings { screenLockMinutes: 45 } -> 400 (not one of 0, 30, 60, 120)", refused.status === 400, refused);

  const after = await h.settings.get();
  const still = (after.body.data as { screenLockMinutes?: unknown } | undefined)?.screenLockMinutes;
  check("the refused save left the stored value at 30", still === 30, after);
}
