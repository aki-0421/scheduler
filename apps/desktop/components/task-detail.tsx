"use client";

import { Clock, FileText, History, KeyRound, Target } from "lucide-react";

import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskRowActions } from "@/components/task-actions";
import { Badge } from "@/components/ui/badge";
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
import { formatDateTime, formatDuration, formatTaskSchedule, formatTargetMode } from "@/lib/format";
import type { RunDto, TaskDto } from "@/lib/types";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
  onEdit?: (task: TaskDto) => void;
};

export function TaskDetail({ task, runs, onEdit }: TaskDetailProps) {
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice(0, 6);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate">{task.name}</CardTitle>
              <TaskStatusBadge status={task.status} />
            </div>
            <CardDescription className="mt-2">
              {task.description || "No description"}
            </CardDescription>
          </div>
          <TaskRowActions
            task={task}
            onEdit={(selected) => onEdit?.(selected)}
          />
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Expression</span>
              <span className="text-right font-medium">{formatTaskSchedule(task)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Timezone</span>
              <span className="font-medium">{task.timezone}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Next run</span>
              <span className="font-medium tabular-nums">
                {formatDateTime(task.nextRunAt)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Missed policy</span>
              <Badge variant="outline">{task.policies.missedPolicy}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4" aria-hidden="true" />
              Target
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Mode</span>
              <span className="font-medium">{formatTargetMode(task.target.mode)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Repository</span>
              <span className="max-w-96 truncate text-right font-mono text-xs">
                {task.target.repoPath ?? "App-managed workspace"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Base ref</span>
              <span className="font-medium">{task.target.baseRef ?? "default"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden="true" />
              Permissions
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Schedule CLI</span>
              <Badge variant={task.policies.allowScheduleCli ? "success" : "muted"}>
                {task.policies.allowScheduleCli ? "allowed" : "blocked"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {(task.policies.scheduleCliCapabilities ?? []).map((capability) => (
                <Badge key={capability} variant="outline">
                  {capability}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" aria-hidden="true" />
              Prompt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-pretty">
              {task.prompt.body}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>Last scheduler executions for this task.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled for</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Exit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.length ? (
                recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateTime(run.scheduledFor)}
                    </TableCell>
                    <TableCell>{formatDuration(run)}</TableCell>
                    <TableCell>{run.exitCode ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            Audit trail
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground">
          <p>task.create recorded when this task was saved.</p>
          {recentRuns[0] ? <p>Latest run: {recentRuns[0].id}</p> : null}
        </CardContent>
      </Card>

    </div>
  );
}
