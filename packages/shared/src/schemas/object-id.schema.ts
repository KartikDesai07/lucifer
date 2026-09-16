import { z } from "zod";

// Lower-case only: every id the client sees is server-serialised lower-case
// hex (Mongo ObjectId.toString()), so a well-formed but upper-case id is not
// one this platform ever hands out — treat it as invalid rather than casting.
export const OBJECT_ID_HEX_PATTERN = /^[0-9a-f]{24}$/;

export const objectIdString = z.string().regex(OBJECT_ID_HEX_PATTERN, "Invalid id");

export const isObjectIdString = (v: unknown): v is string =>
  typeof v === "string" && OBJECT_ID_HEX_PATTERN.test(v);
