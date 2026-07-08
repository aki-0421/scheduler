"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  FolderGit2,
  LayoutDashboard,
  ListTodo,
  Menu,
  Plus,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
          ? `${health.data.runningCount.toLocaleString("en-US")} running · ${health.data.queuedCount.toLocaleString("en-US")} queued`
          : "Daemon status"}
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
        aria-label="Toggle scheduler"
      />
    </div>
  );
}

function AppMark() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background shadow-sm shadow-foreground/[0.02]">
        <CalendarClock className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-5">Codex Scheduler</p>
        <p className="truncate text-xs text-muted-foreground">Local automation</p>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
}: {
  item: (typeof navItems)[number];
  active: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="grid gap-1 p-3" aria-label="Main navigation">
      {navItems.map((item) => (
        <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
      ))}
    </nav>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh w-[min(86vw,280px)] translate-x-0 translate-y-0 content-start rounded-none border-y-0 border-l-0 p-0 shadow-lg sm:max-w-none">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="border-b px-4 py-3">
          <AppMark />
        </div>
        <nav className="grid gap-1 p-3" aria-label="Mobile navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <DialogClose key={item.href} asChild>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </DialogClose>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <div
        className="flex min-h-dvh"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <aside className="hidden w-56 shrink-0 border-r bg-surface md:block">
          <div className="flex h-16 items-center border-b px-4">
            <AppMark />
          </div>
          <SidebarNav pathname={pathname} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <MobileNav pathname={pathname} />
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
                  New task
                </Link>
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto bg-background">
            <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
