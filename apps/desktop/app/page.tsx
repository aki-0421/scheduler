"use client";

import Link from "next/link";
import { Activity, AlertCircle, Clock, ListTodo, Play, Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatDuration, formatTaskSchedule, isRunActive } from "@/lib/format";
import { useHealth, useRuns, useTasks } from "@/lib/queries";

export default function DashboardPage() {
  const tasks = useTasks();
  const runs = useRuns();
  const health = useHealth();
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];
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

  return (
    <div className="grid gap-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-balance">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Scheduler status, upcoming work, and recent Codex runs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/tasks/new">
              <Plus className="size-4" aria-hidden="true" />
              New Task
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/runs">Open diagnostics</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              Scheduler status
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.data?.schedulerEnabled ? "success" : "muted"}>
              {health.data?.schedulerEnabled ? "Running" : "Paused"}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              daemon {health.data?.version ?? "checking"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              Running now
              <Play className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{runningCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">queued or active runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              Failed last 24h
              <AlertCircle className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{failedLastDay}</p>
            <p className="mt-1 text-xs text-muted-foreground">failed or timed out</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              Requiring review
              <ListTodo className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{requiringReview}</p>
            <p className="mt-1 text-xs text-muted-foreground">triage conditions matched</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              Next 10 runs
            </CardTitle>
            <CardDescription>Active tasks sorted by next_run_at.</CardDescription>
          </CardHeader>
          <CardContent>
            {nextRuns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nextRuns.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        <Link className="hover:underline" href={`/tasks?task=${task.id}`}>
                          {task.name}
                        </Link>
                      </TableCell>
                      <TableCell>{formatTaskSchedule(task)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(task.nextRunAt)}
                      </TableCell>
                      <TableCell>
                        <TaskStatusBadge status={task.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Clock}
                title="No upcoming runs"
                description="Create or resume an active scheduled task to populate this queue."
                action={{ label: "New Task", href: "/tasks/new" }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Latest execution outcomes across all tasks.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentRuns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link className="hover:underline" href={`/runs?run=${run.id}`}>
                          {run.id}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(run.startedAt ?? run.scheduledFor)}
                      </TableCell>
                      <TableCell>{formatDuration(run)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Activity}
                title="No runs yet"
                description="Runs appear here after a task is queued or triggered manually."
                action={{ label: "Open Tasks", href: "/tasks" }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
