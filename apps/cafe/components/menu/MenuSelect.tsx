"use client";

import { cn } from "@/lib/utils";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { FolderIcon, FunnelIcon } from "@/components/menu/menu-icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MenuSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** The HTML's left icon (the category select's folder, the filter select's funnel); none = no icon. */
  icon?: "folder" | "funnel";
  ariaLabel: string;
  /** The cell's own classes: its flex basis and where it is drawn. */
  className?: string;
  dataUi?: string;
}

// The Menu's select (values 4.3, 4.4): the kit's dropdown (never a native <select>, lib/no-native-pickers-paths.test.ts)
// with its trigger in the HTML's 38px select look, the left icon 11px in and the chevron 11px from the right. Its open
// list is the kit's.
export function MenuSelect({ value, onValueChange, options, icon, ariaLabel, className, dataUi }: MenuSelectProps) {
  return (
    <div data-ui={dataUi} className={cn("relative flex", className)}>
      {icon && (
        <span className="pointer-events-none absolute left-[11px] top-[11px] z-[1] text-muted-foreground">
          {icon === "folder" ? <FolderIcon /> : <FunnelIcon />}
        </span>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={ariaLabel} className={cn(MENU_SELECT_TRIGGER_CLASS, !icon && "pl-3")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
