import { resolveAppearance, type AppearanceInput } from "@pos/shared/appearance";

// CR2.4 — the printConfigOf twin (see apps/cafe/lib/print.ts:107-190, and its
// use at components/settings/SettingsForm.tsx:39): `settingsSchema.appearance`
// requires every key once present, but a Settings document written before
// this feature (or one that predates a specific field within it) has none of
// them — seeding the Appearance tab's defaultValues straight off `settings`
// would hand zodResolver `undefined` for a required field, which fails
// validation on submit and can silently block Save on a tab the operator
// never opened. This file exists so S5 (AppearanceFields/SettingsForm) has one
// sanctioned resolver to seed from, exactly like printConfigOf/printSettingsFields
// — never a second copy of "absent means default" logic.

// Only the `appearance` field, never the whole Settings object — mirrors
// PrintSettingsSource in lib/print.ts for the same reason: the server reads a
// Mongoose document and the client reads the DTO, and binding this to either
// shape would force the other to cast.
type AppearanceSettingsSource = {
  appearance?: unknown;
};

/** Resolves a (possibly absent or partial) stored `appearance` into a
 *  complete `AppearanceInput` the Appearance tab can seed `defaultValues`
 *  from. Essentially `resolveAppearance(settings?.appearance)` — kept as its
 *  own named function (rather than inlined at the call site) so S5 imports
 *  one clearly-named resolver, the same way the form imports `printConfigOf`
 *  rather than reading `settings.billShowNumber` directly. */
export function appearanceFormDefaults(settings?: AppearanceSettingsSource | null): AppearanceInput {
  return resolveAppearance(settings?.appearance);
}
