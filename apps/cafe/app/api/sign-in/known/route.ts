import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { PIN_DEVICE_COOKIE } from "@pos/shared/staff-pin";
import { connectDB } from "@/lib/db";
import { serverError, success } from "@/lib/api-helpers";
import { pinDeviceKey, readPinDevice } from "@/lib/pin-device";
import type { KnownPerson } from "@/lib/pin-sign-in-client";
import { shortStaffName, staffInitials } from "@/lib/staff-display";
import { resolveTenantFromHost } from "@/lib/tenant";
import { Staff } from "@/models/Staff";

export const dynamic = "force-dynamic";

// GET /api/sign-in/known — the people this device remembers who can sign in with a PIN: the name
// tiles of the login page and the lock screen (spec 2026-10-16 §5.3). Public by design (the login
// page has no session yet), so it gates itself:
//   1. Host gate — /api is outside the middleware matcher, so the tenant check is done here, as
//      app/api/public/diner/login/route.ts does.
//   2. The signed device cookie (HMAC with the auth secret, httpOnly): it lists only the people who
//      signed in on THIS device with a password. No cookie, a bad signature or no key answers an
//      empty list before any database read, so nobody can list the cafe's staff from elsewhere.
//   3. One read by those ids, active people with a PIN only, names and roles only (never the PIN or
//      its counts). no-store: the answer names people, and no cache on shared WiFi may keep it.

type KnownRow = { _id: unknown; name: string; role: "admin" | "staff" };

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request) {
  try {
    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    const configuredTenant = process.env.TENANT_ID;
    if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
      return noStore(new NextResponse("Not found", { status: 404 }));
    }

    const jar = await cookies();
    const remembered = readPinDevice(
      jar.get(PIN_DEVICE_COOKIE)?.value,
      pinDeviceKey(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
    );
    if (!remembered || remembered.length === 0) return noStore(success({ people: [] }));

    await connectDB();
    const rows = await Staff.find({ _id: { $in: remembered.map((p) => p.id) }, isActive: true, hasPin: true })
      .select("name role")
      .lean<KnownRow[]>();
    const byId = new Map(rows.map((row) => [String(row._id), row]));

    // The cookie's order (newest sign-in first); a person since deactivated, deleted or without a
    // PIN drops out here.
    const people: KnownPerson[] = remembered.flatMap(({ id }) => {
      const row = byId.get(id);
      if (!row) return [];
      return [{ id, name: row.name, shortName: shortStaffName(row.name), initials: staffInitials(row.name), role: row.role }];
    });
    return noStore(success({ people }));
  } catch (error) {
    return noStore(serverError("Failed to load the people on this device", error));
  }
}
