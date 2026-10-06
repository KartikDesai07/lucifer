"use client";

import { useId } from "react";

import { isValidUpiId } from "@pos/shared/print-qr";
import { PRINT_QR_CAPTION_MAX, PRINT_QR_URL_MAX, type QrContent, type QrOptions } from "@pos/shared/print-template";
import { Input } from "@/components/ui/input";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { Field, SectionLink } from "@/components/settings/SettingsFields";
import { ChoiceChips } from "@/components/settings/print-design/ChoiceChips";

const CONTENT_LABEL: Record<QrContent, string> = {
  upi: "Pay with UPI",
  link: "A link",
};
const CONTENT_ORDER: readonly QrContent[] = ["upi", "link"];
// The kitchen ticket's QR is a link only, so its example never asks anyone to pay (review s79 MIN-2).
const CAPTION_HINT_PAY = "Printed under the QR code, e.g. Scan to pay";
const CAPTION_HINT_LINK = "Printed under the QR code, e.g. Scan for our menu";

interface QrOptionsFieldsProps {
  options: QrOptions;
  /** The cafe's saved UPI ID: a pay QR needs one. */
  upiId: string | undefined;
  /** False on the kitchen ticket: its QR is a link only, so the choice and the UPI hint are not shown. */
  allowUpi?: boolean;
  /** What the save gate said about this line, shown under the field it belongs to. */
  problem: string | null;
  onChange: (options: QrOptions) => void;
}

// A caption left empty is removed, never saved as "" (the save gate asks a caption to hold text or be absent).
function withCaption(options: QrOptions, caption: string): QrOptions {
  const next: QrOptions = { ...options };
  delete next.caption;
  return caption === "" ? next : { ...next, caption };
}

// The QR line's two choices: a pay QR for the cafe's own UPI ID, or a link (menu, review page, Instagram). The
// kitchen ticket offers only the link.
export function QrOptionsFields({ options, upiId, allowUpi = true, problem, onChange }: QrOptionsFieldsProps) {
  const urlId = useId();
  const captionId = useId();
  const hasUpi = isValidUpiId(upiId ?? "");
  const caption = options.caption ?? "";

  const chooseContent = (content: QrContent) => {
    if (content === options.content) return;
    const next: QrOptions = content === "upi" ? { content: "upi" } : { content: "link", url: "" };
    onChange(withCaption(next, caption));
  };

  return (
    <div className="space-y-4">
      {allowUpi && (
        <ChoiceChips
          legend="What the QR code opens"
          options={CONTENT_ORDER}
          value={options.content}
          onChange={chooseContent}
          labelOf={(content) => CONTENT_LABEL[content]}
          disabledOptions={hasUpi || options.content === "upi" ? [] : ["upi"]}
        />
      )}
      {allowUpi && !hasUpi && (
        <p className="text-xs text-brand-muted">
          To print a pay QR, add your UPI ID in <SectionLink slug="business">Business details</SectionLink>.
        </p>
      )}
      {options.content === "link" && (
        <Field label="Link" htmlFor={urlId} error={problem ?? undefined} hint="Starts with https://">
          <Input
            id={urlId}
            className={BRAND_CONTROL_CLASS}
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={PRINT_QR_URL_MAX}
            value={options.url}
            onChange={(e) => onChange({ ...options, url: e.target.value })}
          />
        </Field>
      )}
      <Field label="Caption (optional)" htmlFor={captionId} hint={allowUpi ? CAPTION_HINT_PAY : CAPTION_HINT_LINK}>
        <Input
          id={captionId}
          className={BRAND_CONTROL_CLASS}
          maxLength={PRINT_QR_CAPTION_MAX}
          value={caption}
          onChange={(e) => onChange(withCaption(options, e.target.value))}
        />
      </Field>
      {options.content === "upi" && problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
