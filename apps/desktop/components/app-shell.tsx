"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  FolderGit2,
  LayoutDashboard,
  ListTodo,
  Plus,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHealth, useSetSetting, useSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Runs", href: "/runs", icon: Activity },
  { label: "Projects", href: "/projects", icon: FolderGit2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function HealthIndicator() {
  const health = useHealth();
  const status = health.data?.ok ? "Running" : health.isLoading ? "Checking" : "Error";
  const variant = health.data?.ok ? "success" : health.isLoading ? "muted" : "destructive";

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant}>{status}</Badge>
      <span className="hidden text-xs text-muted-foreground tabular-nums md:inline">
        {health.data
          ? `${health.data.runningCount} running · ${health.data.queuedCount} queued`
          : "daemon health"}
      </span>
    </div>
  );
}

function SchedulerEnabledToggle() {
  const settings = useSettings();
  const setSetting = useSetSetting();
  const enabled = settings.data["scheduler.enabled"];

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="global-scheduler-enabled" className="hidden text-xs md:block">
        Scheduler
      </Label>
      <Switch
        id="global-scheduler-enabled"
        checked={enabled}
        disabled={setSetting.isPending}
        onCheckedChange={(checked) =>
          setSetting.mutate(
            { key: "scheduler.enabled", value: checked },
            {
              onError: (error) => {
                toast.error("Could not update scheduler setting", {
                  description:
                    error instanceof Error ? error.message : "Settings command failed.",
                });
              },
            },
          )
        }
        aria-label="Toggle global scheduler enabled"
      />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-muted/30 text-foreground">
      <div
        className="flex min-h-dvh"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
          <div className="flex h-16 items-center gap-3 border-b px-4">
            <div className="flex size-9 items-center justify-center rounded-md border bg-background shadow-sm">
              <CalendarClock className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Codex Scheduler</p>
              <p className="truncate text-xs text-muted-foreground">Local automation</p>
            </div>
          </div>
          <nav className="grid gap-1 p-3" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              return (
                <Button
                  key={item.href}
                  variant={active ? "secondary" : "ghost"}
                  className={cn("justify-start", active && "font-semibold")}
                  asChild
                >
                  <Link href={item.href} aria-current={active ? "page" : undefined}>
                    <Icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <CalendarClock className="size-5" aria-hidden="true" />
              <span className="truncate text-sm font-semibold">Codex Scheduler</span>
            </div>
            <div className="hidden md:block">
              <HealthIndicator />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="md:hidden">
                <HealthIndicator />
              </div>
              <SchedulerEnabledToggle />
              <Button asChild size="sm">
                <Link href="/tasks/new">
                  <Plus className="size-4" aria-hidden="true" />
                  New Task
                </Link>
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
