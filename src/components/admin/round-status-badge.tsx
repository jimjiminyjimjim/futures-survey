import { Badge } from "@/components/ui/badge";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { RoundStatus } from "@/lib/admin/rounds-queries";
import { cn } from "@/lib/utils";

const VARIANT_BY_STATUS: Record<
  RoundStatus,
  "default" | "secondary" | "outline"
> = {
  open: "outline",
  scheduled: "secondary",
  draft: "outline",
  closed: "outline",
};

// Open = green, closed = red (user request). Soft tint + dark text keeps the
// label above WCAG AA contrast in both light and dark mode.
const TONE_BY_STATUS: Partial<Record<RoundStatus, string>> = {
  open: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
  closed:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

export function RoundStatusBadge({
  status,
  size = "default",
}: {
  status: RoundStatus;
  /** "lg" matches the height/radius of a default Button (round page header). */
  size?: "default" | "lg";
}) {
  return (
    <Badge
      variant={VARIANT_BY_STATUS[status]}
      className={cn(
        TONE_BY_STATUS[status],
        size === "lg" && "h-8 rounded-lg px-3 text-sm"
      )}
    >
      {ADMIN_MESSAGES.statusLabels[status]}
    </Badge>
  );
}
