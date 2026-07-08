"use client";

import { AlertTriangle, Clock, FileText, History, KeyRound, Target } from "lucide-react";

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
import {
  formatDateTime,
  formatDuration,
  formatEnumLabel,
  formatTaskSchedule,
  formatTargetMode,
} from "@/lib/format";
import type { RunDto, TaskAuditEvent, TaskDto } from "@/lib/types";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
  auditEvents?: TaskAuditEvent[];
  onEdit?: (task: TaskDto) => void;
};

function formatAuditJson(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return JSON.stringify(value, null, 2);
}

function AuditPayloadDetails({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const formatted = formatAuditJson(value);
  if (!formatted) {
    return null;
  }

  return (
    <details className="rounded-md border bg-muted/30 p-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {label}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs">
        {formatted}
      </pre>
    </details>
  );
}

function AuditEventRow({ event }: { event: TaskAuditEvent }) {
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{event.action}</Badge>
            <Badge variant="muted">actor_type {event.actorType}</Badge>
            {event.actorId ? <Badge variant="muted">{event.actorId}</Badge> : null}
          </div>
          {event.reason ? (
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              {event.reason}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDateTime(event.createdAt)}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <AuditPayloadDetails label="Before" value={event.beforeJson} />
        <AuditPayloadDetails label="After" value={event.afterJson} />
      </div>
    </div>
  );
}

export function TaskDetail({
  task,
  runs,
  auditEvents: loadedAuditEvents,
  onEdit,
}: TaskDetailProps) {
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice(0, 6);
  const auditEvents = loadedAuditEvents ?? task.auditEvents ?? [];
  const isDangerFullAccess = task.codex.sandboxMode === "danger-full-access";

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate">{task.name}</CardTitle>
              <TaskStatusBadge status={task.status} />
              {isDangerFullAccess ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  danger-full-access
                </Badge>
              ) : null}
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
              <span className="text-muted-foreground">timezone</span>
              <span className="font-medium">{task.timezone}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Next run</span>
              <span className="font-medium tabular-nums">
                {formatDateTime(task.nextRunAt)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">missed policy</span>
              <Badge variant="outline">{formatEnumLabel(task.policies.missedPolicy)}</Badge>
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
              <span className="text-muted-foreground">mode</span>
              <span className="font-medium">{formatTargetMode(task.target.mode)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Repository</span>
              <span className="max-w-96 truncate text-right font-mono text-xs">
                {task.target.repoPath ?? "App-managed workspace"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">base ref</span>
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
              <span className="text-muted-foreground">sandbox</span>
              <Badge variant={isDangerFullAccess ? "warning" : "outline"}>
                {formatEnumLabel(task.codex.sandboxMode)}
              </Badge>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Schedule CLI</span>
              <Badge variant={task.policies.allowScheduleCli ? "success" : "muted"}>
                {task.policies.allowScheduleCli ? "Allowed" : "Blocked"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {(task.policies.scheduleCliCapabilities ?? []).map((capability) => (
                <Badge key={capability} variant="outline">
                  {formatEnumLabel(capability)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" aria-hidden="true" />
              prompt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
              {task.prompt.body}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>Recent scheduler runs for this task.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
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
            Audit log
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {auditEvents.length ? (
            auditEvents.map((event) => (
              <AuditEventRow key={event.id} event={event} />
            ))
          ) : (
            <p className="text-muted-foreground">
              The current daemon task API did not return audit events.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
