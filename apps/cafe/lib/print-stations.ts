import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { DEFAULT_STATION_NAME, STATIONS_MAX, defaultStationOf, type StationConfig } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { CreateStationBody, UpdateStationBody } from "@/lib/print-printer-schemas";

// Printing redesign, Phase 2 (spec §6.1, §11): kitchen stations. The first read seeds the default
// "Kitchen"; there is always exactly one default, which can be moved but never deleted. Deleting a station
// clears it everywhere it was chosen (categories, items, printers), so no row points at a station that is
// gone (owner: no stale print data). Never calls connectDB() (the routes do). No console.*.

/** A setup write's answer: the routes turn a refusal into its status and message. */
export type PrintSetupResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

export const STATION_NOT_FOUND = "Station not found";
export const STATION_EXISTS_MESSAGE = "A station with this name already exists.";
export const STATIONS_FULL_MESSAGE = `A cafe can have at most ${STATIONS_MAX} stations.`;
export const STATION_DEFAULT_DELETE_MESSAGE = "The default station can't be deleted. Make another station the default first.";

/** Session 2C (the 2A gate's M7): "Bar" and "bar" would both print BAR, so a name is unique ignoring case. A
 *  pre-check read (the 2A unique index stays as it is on every database); two admins racing can still land a
 *  pair, which the unique index stops when the case matches too (the 2A gate's M8: accepted). */
const NAME_IGNORING_CASE = { locale: "en", strength: 2 } as const;

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  return (await Station.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

interface StationRow {
  _id: Types.ObjectId;
  name: string;
  order: number;
  isDefault: boolean;
}

export function stationWireOf(row: StationRow): StationConfig {
  return { id: String(row._id), name: row.name, order: row.order, isDefault: row.isDefault };
}

async function readStations(): Promise<StationConfig[]> {
  const rows = await Station.find().select("name order isDefault").sort({ order: 1, _id: 1 }).lean<StationRow[]>();
  return rows.map(stationWireOf);
}

/** Seeds the default "Kitchen" (spec §6.1). Two first reads racing both upsert the same name: the unique
 *  name index lets one insert and the other match or collide (a no-op). */
export async function seedDefaultStation(): Promise<void> {
  // The unique name index is what makes the race safe, and connectDB()'s autoIndex build is not awaited
  // (house rule: print-device.ts, crud-route.ts). .init() is memoized per process.
  await Station.init();
  try {
    await Station.updateOne({ name: DEFAULT_STATION_NAME }, { $setOnInsert: { order: 0, isDefault: true } }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/** Every station in display order. The first read seeds the default one. */
export async function listStations(): Promise<StationConfig[]> {
  const stations = await readStations();
  if (stations.length > 0) return stations;
  await seedDefaultStation();
  return readStations();
}

export async function createStation(body: CreateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const stations = await listStations();
  if (stations.length >= STATIONS_MAX) return { ok: false, status: 400, error: STATIONS_FULL_MESSAGE };
  const order = Math.max(...stations.map((station) => station.order)) + 1;
  if (await nameTaken(body.name)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
  try {
    const created = await Station.create({ name: body.name, order, isDefault: false });
    return { ok: true, data: stationWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
    throw error;
  }
}

/** A rename and/or "make this the default". The old default is cleared FIRST, so two defaults never
 *  coexist; a request cut between the two writes leaves none for a moment, and defaultStationOf then
 *  picks the first in order. */
export async function updateStation(id: string, body: UpdateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const station = await Station.findById(id);
  if (station === null) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (body.name !== undefined && (await nameTaken(body.name, id))) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
  if (body.isDefault === true && !station.isDefault) {
    await Station.updateMany({ _id: { $ne: station._id }, isDefault: true }, { $set: { isDefault: false } });
    station.isDefault = true;
  }
  if (body.name !== undefined) station.name = body.name;
  try {
    await station.save();
    return { ok: true, data: stationWireOf(station) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
    throw error;
  }
}

/** Deletes a station that is not the default, then clears it from every category, item and printer that
 *  chose it: they fall back to the default (spec §6.2), as a lookup of a deleted station would. */
export async function deleteStation(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const stations = await readStations();
  const station = stations.find((s) => s.id === id);
  if (station === undefined) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (defaultStationOf(stations)?.id === id) return { ok: false, status: 400, error: STATION_DEFAULT_DELETE_MESSAGE };
  await Station.deleteOne({ _id: id });
  await Promise.all([
    Category.updateMany({ stationId: id }, { $unset: { stationId: "" } }),
    Product.updateMany({ stationId: id }, { $unset: { stationId: "" } }),
    Printer.updateMany({ "slips.kotStations": id }, { $pull: { "slips.kotStations": id } }),
  ]);
  return { ok: true, data: { deleted: true } };
}
