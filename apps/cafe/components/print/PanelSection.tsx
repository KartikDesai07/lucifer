import type { HTMLAttributes, ReactNode } from "react";

import {
  PRINTER_SECTION_BODY_CLASS,
  PRINTER_SECTION_CARD_CLASS,
  PRINTER_SECTION_HEAD_CLASS,
  PRINTER_SECTION_SUB_CLASS,
  PRINTER_SECTION_TILE_CLASS,
  PRINTER_SECTION_TITLE_CLASS,
} from "@/components/print/printer-classes";

interface PanelSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  icon: ReactNode;
  title: string;
  sub?: string;
  children: ReactNode;
}

// One card of the printer panel in the owner's HTML look (values 18; design 7.2): a 34px icon tile, a title and one optional
// line, then the body. Prop-driven; the rest (id, data-*, tabIndex) passes straight to the <section>, so the banner can still
// focus its targets. The Printer setup page's own sections keep PrinterSection.
export function PanelSection({ icon, title, sub, children, className, ...rest }: PanelSectionProps) {
  return (
    <section className={className === undefined ? PRINTER_SECTION_CARD_CLASS : `${PRINTER_SECTION_CARD_CLASS} ${className}`} {...rest}>
      <div className={PRINTER_SECTION_HEAD_CLASS}>
        <span aria-hidden="true" className={PRINTER_SECTION_TILE_CLASS}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={PRINTER_SECTION_TITLE_CLASS}>{title}</h3>
          {sub !== undefined && <p className={PRINTER_SECTION_SUB_CLASS}>{sub}</p>}
        </div>
      </div>
      <div className={PRINTER_SECTION_BODY_CLASS}>{children}</div>
    </section>
  );
}
