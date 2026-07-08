import type { LucideIcon } from "lucide-react";
import Link from "next/link";

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
    <div className="flex min-h-48 items-center justify-center rounded-lg border bg-surface/70 p-8">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="flex size-11 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm shadow-foreground/[0.02]">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-balance">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{description}</p>
        {action ? (
          <Button className="mt-5" asChild={Boolean(action.href)} onClick={action.onClick}>
            {action.href ? <Link href={action.href}>{action.label}</Link> : action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
