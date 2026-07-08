"use client";

import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CalendarClock,
  Clock,
  ListTodo,
  PauseCircle,
  Play,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDateTime,
  formatDuration,
  formatTargetMode,
  formatTaskSchedule,
  isRunActive,
} from "@/lib/format";
import {
  useDaemonDiagnostics,
  useDaemonTickNow,
  useHealth,
  useRuns,
  useSetSetting,
  useSettings,
  useTasks,
} from "@/lib/queries";

type SummaryChipProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: BadgeProps["variant"];
};

function SummaryChip({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: SummaryChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={tone}>{value}</Badge>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
      <div>
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {action ? <div className="flex shrink-0">{action}</div> : null}
    </div>
  );
}

export default function DashboardPage() {
  const tasks = useTasks();
  const runs = useRuns();
  const health = useHealth();
  const diagnostics = useDaemonDiagnostics();
  const tickNow = useDaemonTickNow();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];
  const tasksById = new Map(taskList.map((task) => [task.id, task]));
  const nextRuns = taskList
    .filter((task) => task.status === "active" && task.nextRunAt)
    .sort((left, right) => (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""))
    .slice(0, 10);
  const recentRuns = runList
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice(0, 8);
  const runningCount = runList.filter((run) => isRunActive(run.status)).length;
  const failedSince = Date.now() - 24 * 60 * 60 * 1000;
  const failedLastDay = runList.filter(
    (run) =>
      (run.status === "failed" || run.status === "timed_out") &&
      new Date(run.endedAt ?? run.startedAt ?? run.scheduledFor ?? 0).valueOf() >=
        failedSince,
  ).length;
  const requiringReview = runList.filter(
    (run) =>
      run.status === "failed" ||
      run.status === "timed_out" ||
      (run.findingsCount ?? 0) > 0 ||
      (run.createdScheduleCount ?? 0) > 0,
  ).length;
  const schedulerEnabled =
    health.data?.schedulerEnabled ?? settings.data["scheduler.enabled"];
  const nextRun = nextRuns[0];
  const heroDescription = nextRun
    ? `${nextRun.name} is next, scheduled for ${formatDateTime(nextRun.nextRunAt)}.`
    : taskList.length
      ? "No active task has an upcoming run. Resume or schedule a task to fill the queue."
      : "Create your first scheduled Codex task to start the queue.";
  const codexStatus = diagnostics.data
    ? diagnostics.data.codexPath.exists
      ? "Ready"
      : "Missing"
    : health.data?.ok
      ? "Not checked"
      : "Unavailable";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Today"
        description={heroDescription}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip
          icon={Activity}
          label="Scheduler"
          value={schedulerEnabled ? "On" : "Paused"}
          tone={schedulerEnabled ? "success" : "muted"}
        />
        <SummaryChip
          icon={Play}
          label="Running now"
          value={runningCount.toLocaleString("en-US")}
          tone={runningCount ? "info" : "muted"}
        />
        <SummaryChip
          icon={AlertCircle}
          label="Failed today"
          value={failedLastDay.toLocaleString("en-US")}
          tone={failedLastDay ? "destructive" : "muted"}
        />
        <SummaryChip
          icon={ListTodo}
          label="Needs review"
          value={requiringReview.toLocaleString("en-US")}
          tone={requiringReview ? "warning" : "muted"}
        />
        <SummaryChip
          icon={Stethoscope}
          label="Codex CLI"
          value={codexStatus}
          tone={
            diagnostics.data
              ? diagnostics.data.codexPath.exists
                ? "success"
                : "warning"
              : "muted"
          }
        />
      </div>

      <section className="grid gap-3">
        <SectionHeader
          title="Upcoming runs"
          description="The next scheduled Codex tasks, ordered by their next run time."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks">View tasks</Link>
            </Button>
          }
        />
        {nextRuns.length ? (
          <div className="overflow-hidden rounded-lg border bg-surface/70">
            {nextRuns.map((task) => (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="grid gap-3 border-b p-4 transition-colors duration-150 hover:bg-muted/50 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(9rem,0.8fr)_minmax(10rem,0.8fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTargetMode(task.target.mode)}
                  </p>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Schedule</span>
                  <span className="truncate text-sm">{formatTaskSchedule(task)}</span>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Next run</span>
                  <span className="text-sm tabular-nums">
                    {formatDateTime(task.nextRunAt)}
                  </span>
                </div>
                <div className="md:justify-self-end">
                  <TaskStatusBadge status={task.status} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock}
            title={taskList.length ? "No upcoming runs" : "No tasks yet"}
            description={
              taskList.length
                ? "Scheduled or resumed tasks will appear here when they have a next run time."
                : "Create a scheduled Codex task to see what will run next."
            }
            action={{
              label: taskList.length ? "Open tasks" : "Create first task",
              href: taskList.length ? "/tasks" : "/tasks/new",
            }}
          />
        )}
      </section>

      <section className="grid gap-3">
        <SectionHeader
          title="Recent activity"
          description="The latest run results across every task."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/runs">View runs</Link>
            </Button>
          }
        />
        {recentRuns.length ? (
          <div className="overflow-hidden rounded-lg border bg-surface/70">
            {recentRuns.map((run) => {
              const task = tasksById.get(run.taskId);
              const summary =
                run.resultSummary ??
                run.statusReason ??
                (isRunActive(run.status) ? "Run in progress." : run.id);

              return (
                <Link
                  key={run.id}
                  href={`/runs?run=${run.id}`}
                  className="grid gap-3 border-b p-4 transition-colors duration-150 hover:bg-muted/50 last:border-b-0 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(10rem,0.45fr)_minmax(7rem,0.3fr)] lg:items-center"
                >
                  <div>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {task?.name ?? "Unknown task"}
                    </p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {summary}
                    </p>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Started</span>
                    <span className="text-sm tabular-nums">
                      {formatDateTime(run.startedAt ?? run.scheduledFor)}
                    </span>
                  </div>
                  <div className="grid gap-1 lg:text-right">
                    <span className="text-xs text-muted-foreground">Duration</span>
                    <span className="text-sm tabular-nums">{formatDuration(run)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title="No runs yet"
            description="Runs will appear here after a task is queued or started manually."
            action={{ label: "Open tasks", href: "/tasks" }}
          />
        )}
      </section>

      <section className="grid gap-3 border-t pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 className="text-sm font-medium">Scheduler operations</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Maintenance actions stay here so the dashboard keeps the next run and recent
            activity in focus.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Daemon {health.data?.version ?? "not checked"} · Codex path{" "}
            <span className="font-mono">{settings.data["runner.codex_path"]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={tickNow.isPending}
            onClick={() =>
              tickNow.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.triggered
                      ? "Due run check started"
                      : "The daemon accepted the tick request",
                  ),
                onError: (error) =>
                  toast.error("Could not start the due run check", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "The daemon command failed.",
                  }),
              })
            }
          >
            <CalendarClock className="size-4" aria-hidden="true" />
            Check due runs
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={setSetting.isPending}
            onClick={() =>
              setSetting.mutate(
                { key: "scheduler.enabled", value: false },
                {
                  onSuccess: () => toast.success("Schedules paused"),
                  onError: (error) =>
                    toast.error("Could not pause schedules", {
                      description:
                        error instanceof Error
                          ? error.message
                          : "The settings command failed.",
                    }),
                },
              )
            }
          >
            <PauseCircle className="size-4" aria-hidden="true" />
            Pause schedules
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">Open diagnostics</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
