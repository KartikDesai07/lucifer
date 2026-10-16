import { cn } from "@/lib/utils";
import { AVATAR_HUES, avatarHueIndex } from "@/lib/ui";
import { staffInitials } from "@/lib/staff-display";

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
} as const;

const DOT_SIZES = { sm: "h-2 w-2", md: "h-2.5 w-2.5", lg: "h-4 w-4" } as const;

export function StaffAvatar({
  name,
  seed,
  size = "md",
  status = null,
  className,
}: {
  name: string;
  seed?: string;
  size?: keyof typeof SIZES;
  status?: "online" | "locked" | null;
  className?: string;
}) {
  const hue = AVATAR_HUES[avatarHueIndex(seed ?? name)];
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn("inline-flex items-center justify-center rounded-full font-semibold", SIZES[size])}
        style={{ backgroundColor: hue.bg, color: hue.fg }}
      >
        {staffInitials(name)}
      </span>
      {status && (
        <span
          data-status={status}
          aria-hidden="true"
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-card",
            DOT_SIZES[size],
            status === "online" ? "bg-status-ok" : "bg-subtle-foreground",
          )}
        />
      )}
    </span>
  );
}
