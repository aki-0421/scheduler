import type { LucideIcon } from "lucide-react";

import { AppLink } from "@/components/app-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-40 items-center justify-center px-4 py-8",
        className,
      )}
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="flex size-10 items-center justify-center text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-balance">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {description}
        </p>
        {action ? (
          <Button
            className="mt-5"
            asChild={Boolean(action.href)}
            onClick={action.onClick}
          >
            {action.href ? (
              <AppLink href={action.href}>{action.label}</AppLink>
            ) : (
              action.label
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
