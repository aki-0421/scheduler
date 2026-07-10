import type { LucideIcon } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ValueBadge({
  icon: Icon,
  label,
  variant = "outline",
  title,
  className,
  iconClassName,
}: {
  icon?: LucideIcon;
  label: string;
  variant?: BadgeProps["variant"];
  title?: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Badge
      variant={variant}
      title={title ?? label}
      className={cn("max-w-full", className)}
    >
      {Icon ? (
        <Icon
          className={cn("size-3.5 shrink-0", iconClassName)}
          aria-hidden="true"
        />
      ) : null}
      <span className="truncate">{label}</span>
    </Badge>
  );
}
