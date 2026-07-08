import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-3 md:flex-row md:items-center",
        className,
      )}
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        <h1 className="text-xl font-semibold leading-7 text-balance">
          {title}
        </h1>
        {description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${title} の説明`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/70 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:border-ring/40 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                ?
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="max-w-72">
              {description}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
