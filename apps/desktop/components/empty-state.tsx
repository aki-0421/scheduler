import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded-lg border bg-background p-8">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-base font-medium text-balance">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{description}</p>
        {action ? (
          <Button className="mt-5" asChild={Boolean(action.href)} onClick={action.onClick}>
            {action.href ? <a href={action.href}>{action.label}</a> : action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
