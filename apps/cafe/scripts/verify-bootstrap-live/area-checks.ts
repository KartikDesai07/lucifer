/**
 * Tables B2 - what the bootstrap's `areas` part must look like on the wire,
 * as [label, ok] pairs the live leg feeds to its own `check`. Kept beside the
 * fixture so verify-bootstrap-live.ts stays under the file-length ceiling.
 * (No console output here - the caller prints.)
 */
import type { BootstrapPayload } from "@/lib/bootstrap-contract";
import type { SeedCounts } from "./fixture";

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/;

export function areaPartChecks(payload: BootstrapPayload, seeded: SeedCounts): Array<[string, boolean]> {
  const names = payload.areas.map((a) => a.name);
  // The wire form of the tables part: JSON turns the ObjectId into its hex string.
  const wireTables = JSON.parse(JSON.stringify(payload.tables)) as { areaId?: unknown }[];
  const wireAreaIds = wireTables.flatMap((t) => (typeof t.areaId === "string" ? [t.areaId] : []));
  const areaIds = payload.areas.map((a) => String(a._id));
  return [
    [
      `areas part carries the ${seeded.areas} seeded areas in ARRANGED order, not name order (${names.join(", ")})`,
      payload.areas.length === seeded.areas &&
        names[0] === seeded.rooftopAreaName &&
        names.join() !== [...names].sort().join(),
    ],
    [
      "tables[].areaId is a 24-hex string equal to one of areas[]._id (an area-less table carries no key)",
      wireAreaIds.length === 1 && wireAreaIds.every((id) => OBJECT_ID_HEX.test(id) && areaIds.includes(id)),
    ],
  ];
}
