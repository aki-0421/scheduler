import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-status-error-border bg-status-error-muted text-status-error-muted-foreground",
        error:
          "border-status-error-border bg-status-error-muted text-status-error-muted-foreground",
        outline: "text-foreground",
        success:
          "border-status-success-border bg-status-success-muted text-status-success-muted-foreground",
        warning:
          "border-status-warning-border bg-status-warning-muted text-status-warning-muted-foreground",
        info: "border-status-info-border bg-status-info-muted text-status-info-muted-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
