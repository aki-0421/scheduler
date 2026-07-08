"use client";

import { type ReactNode } from "react";
import {
  AlertTriangle,
  Clock,
  FileText,
  History,
  KeyRound,
  Target,
  type LucideIcon,
} from "lucide-react";

import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskRowActions } from "@/components/task-actions";
import {
  CopyButton,
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatReadableEnum,
  formatRunDuration,
} from "@/components/task-run-display";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunDto, TaskAuditEvent, TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
  auditEvents?: TaskAuditEvent[];
  onEdit?: (task: TaskDto) => void;
};

function DetailSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-lg border bg-surface/70 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon ? (
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <h2 className="text-base font-semibold text-balance">{title}</h2>
          </div>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function DefinitionItem({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-background p-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm font-medium">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}

function PathValue({ value, fallback = "Not set" }: { value?: string; fallback?: string }) {
  if (!value) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-xs" title={value}>
        {value}
      </span>
      <CopyButton
        value={value}
        label="Copy"
        toastLabel="Path"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 px-2 text-xs"
      />
    </span>
  );
}

function formatSeconds(value?: number) {
  if (!value) {
    return "Not set";
  }

  if (value < 60) {
    return `${value} sec`;
  }
  if (value < 3_600) {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  const hours = Math.floor(value / 3_600);
  const minutes = Math.round((value % 3_600) / 60);
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

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
            <Badge variant="outline">{formatReadableEnum(event.action)}</Badge>
            <Badge variant="muted">Actor: {formatReadableEnum(event.actorType)}</Badge>
            {event.actorId ? <Badge variant="muted">{event.actorId}</Badge> : null}
          </div>
          {event.reason ? (
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              {event.reason}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatAbsoluteDateTime(event.createdAt)}
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
  const schedule = describeTaskSchedule(task);
  const target = describeTaskTarget(task);
  const capabilities = task.policies.scheduleCliCapabilities ?? [];
  const retryDetail =
    task.policies.maxRetries && task.policies.maxRetries > 0
      ? `${task.policies.maxRetries} retries · ${formatSeconds(task.policies.retryBackoffSec)} backoff`
      : "No automatic retries";

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-lg border bg-surface/70 p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-balance">
                {task.name}
              </h2>
              <TaskStatusBadge status={task.status} />
              {isDangerFullAccess ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Full access
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              {task.description || "No description"}
            </p>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {task.id}
            </p>
          </div>
          <TaskRowActions
            task={task}
            className="shrink-0 justify-start lg:justify-end"
            onEdit={(selected) => onEdit?.(selected)}
          />
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DefinitionItem
            label="Schedule"
            value={schedule.label}
            detail={schedule.detail}
          />
          <DefinitionItem
            label="Next run"
            value={
              <span className="tabular-nums">
                {formatAbsoluteDateTime(task.nextRunAt)}
              </span>
            }
          />
          <DefinitionItem
            label="Target"
            value={target.label}
            detail={
              <span className="block truncate font-mono" title={target.detail}>
                {target.detail ?? "App-managed workspace"}
              </span>
            }
          />
        </dl>
      </section>

      <DetailSection
        title="Prompt"
        description="Instruction that will be sent to Codex for each run."
        icon={FileText}
        actions={<CopyButton value={task.prompt.body} toastLabel="Prompt" />}
      >
        <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5">
          {task.prompt.body}
        </pre>
      </DetailSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailSection
          title="Schedule and target"
          description="When this task runs and where Codex will execute."
          icon={Clock}
        >
          <dl className="grid gap-3">
            <DefinitionItem
              label="Schedule"
              value={schedule.label}
              detail={schedule.detail}
            />
            <DefinitionItem label="Timezone" value={task.timezone} />
            <DefinitionItem
              label="Next run"
              value={
                <span className="tabular-nums">
                  {formatAbsoluteDateTime(task.nextRunAt)}
                </span>
              }
            />
            <DefinitionItem
              label="Missed runs"
              value={formatReadableEnum(task.policies.missedPolicy)}
              detail={
                task.policies.missedWindowDays
                  ? `${task.policies.missedWindowDays} day window`
                  : undefined
              }
            />
            <DefinitionItem
              label="Target mode"
              value={target.label}
              detail={target.detail}
            />
            <DefinitionItem
              label="Repository"
              value={<PathValue value={task.target.repoPath} fallback="App-managed workspace" />}
            />
            <DefinitionItem
              label="Base ref"
              value={
                <span className="font-mono text-xs">
                  {task.target.baseRef ?? "default"}
                </span>
              }
            />
          </dl>
        </DetailSection>

        <DetailSection
          title="Execution and safety"
          description="Codex model, permissions, runtime, and scheduler controls."
          icon={KeyRound}
        >
          <dl className="grid gap-3">
            <DefinitionItem value={task.codex.model ?? "Default model"} label="Model" />
            <DefinitionItem
              label="Reasoning effort"
              value={formatReadableEnum(task.codex.reasoningEffort)}
            />
            <DefinitionItem
              label="Sandbox"
              value={
                <Badge variant={isDangerFullAccess ? "warning" : "outline"}>
                  {formatReadableEnum(task.codex.sandboxMode)}
                </Badge>
              }
            />
            <DefinitionItem
              label="Approval policy"
              value={formatReadableEnum(task.codex.approvalPolicy)}
            />
            <DefinitionItem
              label="Max runtime"
              value={formatSeconds(task.policies.maxRuntimeSec)}
            />
            <DefinitionItem label="Retries" value={retryDetail} />
            <DefinitionItem
              label="Overlap policy"
              value={formatReadableEnum(task.policies.overlapPolicy)}
            />
            <DefinitionItem
              label="Schedule CLI"
              value={
                <Badge variant={task.policies.allowScheduleCli ? "success" : "muted"}>
                  {task.policies.allowScheduleCli ? "Allowed" : "Blocked"}
                </Badge>
              }
              detail={
                capabilities.length
                  ? capabilities.map(formatReadableEnum).join(", ")
                  : "No extra schedule capabilities"
              }
            />
            <DefinitionItem
              label="Created schedules cap"
              value={task.policies.maxCreatedSchedulesPerRun ?? "Not capped"}
            />
            <DefinitionItem
              label="Cleanup"
              value={formatReadableEnum(task.policies.cleanupPolicy)}
              detail={
                task.policies.cleanupAfterDays
                  ? `${task.policies.cleanupAfterDays} day retention`
                  : undefined
              }
            />
            <DefinitionItem
              label="Scheduler instructions"
              value={
                task.prompt.injectSchedulerInstructions ? "Injected" : "Not injected"
              }
            />
          </dl>
        </DetailSection>
      </div>

      <DetailSection
        title="Recent runs"
        description="Recent scheduler runs for this task."
        icon={Target}
      >
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
                      {formatAbsoluteDateTime(run.scheduledFor)}
                    </TableCell>
                    <TableCell>{formatRunDuration(run)}</TableCell>
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
      </DetailSection>

      <DetailSection title="Audit log" icon={History}>
        <div className="grid gap-3 text-sm">
          {auditEvents.length ? (
            auditEvents.map((event) => <AuditEventRow key={event.id} event={event} />)
          ) : (
            <p className="text-muted-foreground">
              The current daemon task API did not return audit events.
            </p>
          )}
        </div>
      </DetailSection>
    </div>
  );
}
