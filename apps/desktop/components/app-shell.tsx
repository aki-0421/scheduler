"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  ChevronRight,
  Folder,
  FolderGit2,
  Loader2,
  Menu,
  Plus,
  Settings,
  Timer,
} from "lucide-react";
import { Suspense, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { isRunActive } from "@/lib/format";
import { useHealth, useRuns, useTasks } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function normalizePathname(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function isTaskRoute(
  pathname: string,
  selectedTaskId: string | undefined,
  taskId: string,
) {
  return pathname === "/tasks" && selectedTaskId === taskId;
}

function formatTaskTime(task: TaskDto, running: boolean) {
  if (running) {
    return "実行中";
  }
  if (!task.nextRunAt) {
    return "未定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(task.nextRunAt));
}

function HeaderCounts() {
  const health = useHealth();
  const running = health.data?.runningCount ?? 0;
  const queued = health.data?.queuedCount ?? 0;

  return (
    <div
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      aria-label="実行状態"
    >
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2 tabular-nums">
        <Activity className="size-4" aria-hidden="true" />
        {running.toLocaleString("ja-JP")}
      </span>
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2 tabular-nums">
        <Timer className="size-4" aria-hidden="true" />
        {queued.toLocaleString("ja-JP")}
      </span>
    </div>
  );
}

function shortIdentifier(value: string) {
  return value.length > 18 ? `${value.slice(0, 18)}...` : value;
}

function HeaderBreadcrumbs({
  pathname,
  selectedTaskId,
  selectedRunId,
}: {
  pathname: string;
  selectedTaskId?: string;
  selectedRunId?: string;
}) {
  const tasks = useTasks();
  const runs = useRuns();
  const task = selectedTaskId
    ? (tasks.data ?? []).find((item) => item.id === selectedTaskId)
    : undefined;
  const run = selectedRunId
    ? (runs.data ?? []).find((item) => item.id === selectedRunId)
    : undefined;
  const crumbs: BreadcrumbItem[] = (() => {
    if (pathname === "/tasks/new") {
      return [
        { label: "アーカイブ済み", href: "/tasks?view=archived" },
        { label: "新規タスク" },
      ];
    }
    if (pathname === "/tasks" && selectedTaskId) {
      return [
        { label: "アーカイブ済み", href: "/tasks?view=archived" },
        { label: task?.name ?? shortIdentifier(selectedTaskId) },
      ];
    }
    if (pathname === "/tasks") {
      return [{ label: "アーカイブ済み" }];
    }
    if (pathname === "/runs" && selectedRunId) {
      return [
        { label: "実行履歴", href: "/runs" },
        { label: shortIdentifier(run?.id ?? selectedRunId) },
      ];
    }
    if (pathname === "/runs") {
      return [{ label: "実行履歴" }];
    }
    if (pathname === "/settings") {
      return [{ label: "設定" }];
    }
    return [{ label: "プロジェクト" }];
  })();

  return (
    <nav className="min-w-0" aria-label="パンくず">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li
              key={`${crumb.label}-${index}`}
              className="flex min-w-0 items-center gap-1"
            >
              {index > 0 ? (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              {crumb.href && !current ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "truncate",
                    current
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                  aria-current={current ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ProjectLink({
  pathname,
  close,
}: {
  pathname: string;
  close?: boolean;
}) {
  const active = isActivePath(pathname, "/projects");
  const content = (
    <Link
      href="/projects"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <FolderGit2 className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">プロジェクト</span>
    </Link>
  );

  return close ? <DialogClose asChild>{content}</DialogClose> : content;
}

function TaskLink({
  task,
  running,
  active,
  close,
}: {
  task: TaskDto;
  running: boolean;
  active: boolean;
  close?: boolean;
}) {
  const content = (
    <Link
      href={`/tasks?task=${encodeURIComponent(task.id)}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group grid min-h-11 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <span className="pt-0.5">
        {running ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Timer className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{task.name}</span>
        <span className="mt-0.5 block truncate text-xs opacity-75">
          {formatTaskTime(task, running)}
        </span>
      </span>
    </Link>
  );

  return close ? <DialogClose asChild>{content}</DialogClose> : content;
}

function ArchivedLink({ active, close }: { active: boolean; close?: boolean }) {
  const content = (
    <Link
      href="/tasks?view=archived"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Folder className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">アーカイブ済み</span>
    </Link>
  );

  return close ? <DialogClose asChild>{content}</DialogClose> : content;
}

function SettingsTool({ active, close }: { active: boolean; close?: boolean }) {
  const content = (
    <Link
      href="/settings"
      aria-current={active ? "page" : undefined}
      aria-label="設定"
      title="設定"
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Settings className="size-4" aria-hidden="true" />
    </Link>
  );

  return close ? <DialogClose asChild>{content}</DialogClose> : content;
}

function SidebarContent({
  pathname,
  selectedTaskId,
  close,
}: {
  pathname: string;
  selectedTaskId?: string;
  close?: boolean;
}) {
  const tasks = useTasks();
  const runs = useRuns();
  const runningTaskIds = new Set(
    (runs.data ?? [])
      .filter((run) => isRunActive(run.status))
      .map((run) => run.taskId),
  );
  const taskList = tasks.data ?? [];
  const scheduledTasks = taskList
    .filter(
      (task) =>
        (task.status === "active" && task.kind === "cron" && task.nextRunAt) ||
        runningTaskIds.has(task.id),
    )
    .sort((left, right) => {
      const leftRunning = runningTaskIds.has(left.id);
      const rightRunning = runningTaskIds.has(right.id);
      if (leftRunning !== rightRunning) {
        return leftRunning ? -1 : 1;
      }
      return (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? "");
    });
  const archiveActive = pathname === "/tasks" && !selectedTaskId;

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      <div className="p-3">
        <ProjectLink pathname={pathname} close={close} />
      </div>
      <Separator />
      <nav
        className="min-h-0 flex-1 overflow-y-auto p-3"
        aria-label="実行予定タスク"
      >
        <div className="grid gap-1">
          {tasks.isLoading ? (
            <>
              <div className="h-11 rounded-md bg-muted" />
              <div className="h-11 rounded-md bg-muted" />
            </>
          ) : scheduledTasks.length ? (
            scheduledTasks.map((task) => (
              <TaskLink
                key={task.id}
                task={task}
                running={runningTaskIds.has(task.id)}
                active={isTaskRoute(pathname, selectedTaskId, task.id)}
                close={close}
              />
            ))
          ) : (
            <div className="rounded-md px-3 py-2 text-sm text-muted-foreground">
              予定されたタスクはありません
            </div>
          )}
        </div>
      </nav>
      <Separator />
      <div className="p-3">
        <ArchivedLink active={archiveActive} close={close} />
      </div>
      <Separator />
      <div className="flex h-14 shrink-0 items-center justify-end px-3">
        <SettingsTool
          active={isActivePath(pathname, "/settings")}
          close={close}
        />
      </div>
    </div>
  );
}

function MobileNav({
  pathname,
  selectedTaskId,
}: {
  pathname: string;
  selectedTaskId?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="ナビゲーションを開く">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh w-[min(86vw,300px)] translate-x-0 translate-y-0 content-start rounded-none border-y-0 border-l-0 p-0 shadow-lg sm:max-w-none">
        <DialogTitle className="sr-only">ナビゲーション</DialogTitle>
        <SidebarContent
          pathname={pathname}
          selectedTaskId={selectedTaskId}
          close
        />
      </DialogContent>
    </Dialog>
  );
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const normalizedPathname = normalizePathname(pathname);
  const searchParams = useSearchParams();
  const selectedTaskId = searchParams.get("task") ?? undefined;
  const selectedRunId = searchParams.get("run") ?? undefined;

  return (
    <div className="h-dvh overflow-hidden bg-surface text-foreground">
      <div
        className="flex h-full min-h-0 overflow-hidden"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <aside className="hidden h-full w-64 shrink-0 overflow-hidden border-r bg-surface md:block">
          <SidebarContent
            pathname={normalizedPathname}
            selectedTaskId={selectedTaskId}
          />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <MobileNav
                pathname={normalizedPathname}
                selectedTaskId={selectedTaskId}
              />
            </div>
            <div className="min-w-0 flex-1">
              <HeaderBreadcrumbs
                pathname={normalizedPathname}
                selectedTaskId={selectedTaskId}
                selectedRunId={selectedRunId}
              />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <HeaderCounts />
              <Button asChild size="sm">
                <Link href="/tasks/new">
                  <Plus className="size-4" aria-hidden="true" />
                  新規タスク
                </Link>
              </Button>
            </div>
          </header>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-background">
            <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="h-dvh bg-background text-foreground">{children}</div>
      }
    >
      <AppShellContent>{children}</AppShellContent>
    </Suspense>
  );
}
