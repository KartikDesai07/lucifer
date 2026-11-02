import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MENU_EDITOR_ERROR_CLASS, MENU_EDITOR_FIELD_CLASS, MENU_EDITOR_LABEL_CLASS } from "@/lib/menu-editor-layout";

interface EditorFieldProps {
  label: string;
  /** Pairs the label with a native input's id (omit for a kit select, which has none to give). */
  htmlFor?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

// The editor's field (values 9.2): the 13px 600 label 6px above its control, the 12.5px --bad-i error under it.
export function EditorField({ label, htmlFor, error, className, children }: EditorFieldProps) {
  return (
    <div className={cn(MENU_EDITOR_FIELD_CLASS, className)}>
      <Label htmlFor={htmlFor} className={MENU_EDITOR_LABEL_CLASS}>
        {label}
      </Label>
      {children}
      {error && <p className={MENU_EDITOR_ERROR_CLASS}>{error}</p>}
    </div>
  );
}
