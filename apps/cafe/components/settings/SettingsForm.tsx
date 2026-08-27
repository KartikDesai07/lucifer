"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import type { FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { settingsSchema, type SettingsInput } from "@/schemas";
import { useUpdateSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { appearanceFormDefaults } from "@/lib/appearance-form";
import { Button } from "@/components/ui/button";
import { GeneralSettingsFields } from "@/components/settings/GeneralSettingsFields";
import { AppearanceFields } from "@/components/settings/AppearanceFields";
import { PrintSettingsFields } from "@/components/settings/PrintSettingsFields";
import { PromoCodesFields } from "@/components/settings/PromoCodesFields";
import { IntegrationsFields } from "@/components/settings/IntegrationsFields";
import type { Settings } from "@/types";

interface SettingsFormProps {
  settings: Settings;
}

type SettingsTab = "general" | "appearance" | "print" | "integrations";

export function SettingsForm({ settings }: SettingsFormProps) {
  const updateSettings = useUpdateSettings();
  const [tab, setTab] = useState<SettingsTab>("general");

  // The 23 print fields are REQUIRED by settingsSchema, but a Settings
  // document written before this feature has none of them — getSettings()
  // reads with `.lean()`, so Mongoose's schema defaults never apply, and the
  // fetched object genuinely lacks those keys. Seeding defaultValues straight
  // off `settings` would hand zodResolver `undefined` for every one of them,
  // which fails validation and silently blocks Save. printConfigOf() is the
  // one sanctioned place that resolves "absent means the documented default"
  // (see apps/cafe/lib/print.ts) — reused here instead of a second copy of
  // those defaults.
  const printConfig = printConfigOf(settings);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      restaurantName: settings.restaurantName,
      tagline: settings.tagline,
      mobile: settings.mobile,
      address: settings.address,
      receiptHeader: settings.receiptHeader,
      receiptFooter: settings.receiptFooter,
      gstEnabled: settings.gstEnabled,
      gstNumber: settings.gstNumber,
      gstRate: settings.gstRate,
      gstMode: settings.gstMode,
      logo: settings.logo ?? "",
      // settingsSchema requires productLogo on every submit (zodResolver
      // validates the FULL object) — omitting it here would fail validation
      // silently on Save for any doc written before this field existed.
      productLogo: settings.productLogo ?? "",
      fssai: settings.fssai ?? "",

      billShowNumber: printConfig.bill.showNumber,
      billNumberStart: printConfig.bill.numberStart,
      billShowLogo: printConfig.bill.showLogo,
      billLogoSize: printConfig.bill.logoSize,
      billShowAddress: printConfig.bill.showAddress,
      billShowMobile: printConfig.bill.showMobile,
      billShowGstNumber: printConfig.bill.showGstNumber,
      billShowFssai: printConfig.bill.showFssai,
      billPaperWidth: printConfig.bill.paperWidth,
      billFontSize: printConfig.bill.fontSize,

      kotShowPrices: printConfig.kot.showPrices,
      kotShowTotal: printConfig.kot.showTotal,
      kotShowNumber: printConfig.kot.showNumber,
      kotNumberStart: printConfig.kot.numberStart,
      kotNumberVoidSlips: printConfig.kot.numberVoidSlips,
      kotShowLogo: printConfig.kot.showLogo,
      kotShowRestaurantName: printConfig.kot.showRestaurantName,
      kotShowTable: printConfig.kot.showTable,
      kotShowStaff: printConfig.kot.showStaff,
      kotShowTime: printConfig.kot.showTime,
      kotShowNotes: printConfig.kot.showNotes,
      kotPaperWidth: printConfig.kot.paperWidth,
      kotFontSize: printConfig.kot.fontSize,

      // Same lean-doc hazard as productLogo above: a pre-CR2 Settings
      // document carries none of these three, so defaultValues must supply
      // the fallback or zodResolver fails validation silently on Save.
      selfOrderMode: settings.selfOrderMode ?? "approve",
      allowTableChange: settings.allowTableChange ?? true,
      showPastOrdersToDiner: settings.showPastOrdersToDiner ?? true,

      // CR2.2c — @pos/shared's Settings type (types.ts) predates this field
      // (P1 landed the storage/validation contract, not this client type), so
      // it isn't a typed key on `settings` yet. Read it the same defensive
      // way as every other optional field on this doc: a local cast, never an
      // assumption the key is present.
      promoCodes: (settings as Settings & { promoCodes?: SettingsInput["promoCodes"] }).promoCodes ?? [],

      // CR2.3b — same lean-doc hazard as above: a pre-Telegram Settings
      // document carries no telegramPaused key at all.
      telegramPaused: settings.telegramPaused ?? false,

      // CR2.4 — appearance is a nested subdoc (settings.schema.ts requires
      // every key once present), so a pre-CR2.4 Settings document has none of
      // them at all. appearanceFormDefaults resolves that the same way
      // printConfigOf resolves the print block above — never a second copy of
      // "absent means the documented default". Same type-drift cast as
      // promoCodes above: @pos/shared's Settings type predates this field.
      appearance: appearanceFormDefaults(settings as Settings & { appearance?: unknown }),
    },
  });

  const onSubmit = (values: SettingsInput) => {
    updateSettings.mutate(values);
  };

  // react-hook-form skips onSubmit on an invalid form and just calls
  // `.focus()` on the first errored field — a no-op on a `display:none`
  // panel (inactive tab) and impossible on a field a collapsed reveal has
  // unmounted. Without this, Save silently does nothing. The nested
  // `appearance` subdoc reports one top-level key, every print field is named
  // `bill*`/`kot*`, every Telegram field `telegram*`; everything else lives
  // on the General tab.
  const onInvalid = (formErrors: FieldErrors<SettingsInput>) => {
    const [firstField] = Object.keys(formErrors) as Array<keyof SettingsInput>;
    if (!firstField) return;
    // CR2.4 — checked BEFORE the bill*/kot*/telegram* branches: "appearance"
    // is the field's own name (a nested-object error reports one top-level
    // key, never "appearance.presetId"), so it can never collide with those
    // prefixes, but it still reads as the first-checked, most-specific branch.
    const nextTab: SettingsTab = firstField.startsWith("appearance")
      ? "appearance"
      : firstField.startsWith("bill") || firstField.startsWith("kot")
        ? "print"
        : firstField.startsWith("telegram")
          ? "integrations"
          : "general";
    setTab(nextTab);
    const message = formErrors[firstField]?.message;
    toast.error(typeof message === "string" && message ? message : "Check the highlighted field before saving");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-6">
      {/* No shadcn Tabs primitive exists in this repo (components/ui/** is
          hook-blocked), so this is a plain segmented control over the
          existing Button, wired for a11y by hand. */}
      <div role="tablist" aria-label="Settings sections" className="inline-flex gap-1 rounded-lg border p-1">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "general"}
          variant={tab === "general" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("general")}
        >
          General
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "appearance"}
          variant={tab === "appearance" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("appearance")}
        >
          Appearance
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "print"}
          variant={tab === "print" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("print")}
        >
          Print customization
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "integrations"}
          variant={tab === "integrations" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("integrations")}
        >
          Integrations
        </Button>
      </div>

      {/* All FOUR tab panels stay MOUNTED at all times — only the inactive
          ones are hidden with the `hidden` class, never unmounted. This is
          ONE react-hook-form instance with ONE submit covering every field on
          every tab; unmounting a panel would drop its fields' registered
          values (react-hook-form's default un-registration behavior), which
          would silently reset that tab's settings back to their defaults on
          every save. */}
      <div className={tab === "general" ? "space-y-6" : "hidden"}>
        <GeneralSettingsFields
          control={control}
          register={register}
          setValue={setValue}
          watch={watch}
          errors={errors}
        />
        <PromoCodesFields control={control} register={register} errors={errors} />
      </div>

      <div className={tab === "appearance" ? "space-y-6" : "hidden"}>
        <AppearanceFields control={control} />
      </div>

      <div className={tab === "print" ? "space-y-6" : "hidden"}>
        <PrintSettingsFields
          control={control}
          register={register}
          setValue={setValue}
          watch={watch}
          errors={errors}
        />
      </div>

      <div className={tab === "integrations" ? "space-y-6" : "hidden"}>
        <IntegrationsFields control={control} />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="submit"
          disabled={updateSettings.isPending || !isDirty}
          size="lg"
        >
          {updateSettings.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save settings
        </Button>
      </div>
    </form>
  );
}
