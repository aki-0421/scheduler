"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { RunDetail } from "@/components/run-detail";
import { RunStatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useRun, useRuns, useTasks } from "@/lib/queries";
import { runStatuses, type RunStatus } from "@/lib/types";

type RunPreset = "recent" | "failed" | "needs_attention";

function RunsPageContent() {
  const searchParams = useSearchParams();
  const selectedRunId = searchParams.get("run") ?? undefined;
  const [preset, setPreset] = useState<RunPreset>("recent");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");
  const [taskFilter, setTaskFilter] = useState("all");
  const tasks = useTasks();
  const runs = useRuns({
    status: statusFilter === "all" ? undefined : statusFilter,
    taskId: taskFilter === "all" ? undefined : taskFilter,
  });
  const selectedRun = useRun(selectedRunId);
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];
  const taskById = new Map(taskList.map((task) => [task.id, task]));
  const sortedRunList = runList
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? right.queuedAt ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? left.queuedAt ?? "",
      ),
    );
  const displayedRunList = sortedRunList.filter((run) => {
    if (preset === "failed") {
      return run.status === "failed";
    }
    if (preset === "needs_attention") {
      return ["failed", "timed_out", "interrupted"].includes(run.status);
    }
    return true;
  });

  function applyPreset(next: RunPreset) {
    setPreset(next);
    if (next !== "recent") {
      setStatusFilter("all");
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-balance">Runs</h1>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Inspect execution history, triage failures, and tail logs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={preset === "failed" ? "default" : "outline"}
            onClick={() => applyPreset("failed")}
          >
            Failed
          </Button>
          <Button
            type="button"
            variant={preset === "needs_attention" ? "default" : "outline"}
            onClick={() => applyPreset("needs_attention")}
          >
            Needs attention
          </Button>
          <Button
            type="button"
            variant={preset === "recent" ? "default" : "outline"}
            onClick={() => applyPreset("recent")}
          >
            Recent
          </Button>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setPreset("recent");
              setStatusFilter(value as RunStatus | "all");
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {runStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={taskFilter} onValueChange={setTaskFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tasks</SelectItem>
              {taskList.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Run history</CardTitle>
            <CardDescription>
              {displayedRunList.length.toLocaleString()} run
              {displayedRunList.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {displayedRunList.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled for</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Exit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedRunList.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          href={`/runs?run=${run.id}`}
                          className="font-medium hover:underline"
                        >
                          {taskById.get(run.taskId)?.name ?? run.taskId}
                        </Link>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {run.id}
                        </p>
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(run.scheduledFor)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(run.startedAt)}
                      </TableCell>
                      <TableCell>{formatDuration(run)}</TableCell>
                      <TableCell>{run.exitCode ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Activity}
                title="No runs match filters"
                description="Clear filters or queue a task manually to populate run history."
                action={{ label: "Open Tasks", href: "/tasks" }}
              />
            )}
            {/* TODO: Add mark reviewed/archive actions when the DB schema supports triage state. */}
          </CardContent>
        </Card>

        {selectedRunId ? (
          selectedRun.data ? (
            <RunDetail
              run={selectedRun.data}
              task={taskById.get(selectedRun.data.taskId)}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Run detail</CardTitle>
                <CardDescription>Loading selected run.</CardDescription>
              </CardHeader>
            </Card>
          )
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Run detail</CardTitle>
              <CardDescription>
                Select a run to inspect metadata, logs, last message, and retry actions.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading runs...</div>}>
      <RunsPageContent />
    </Suspense>
  );
}
