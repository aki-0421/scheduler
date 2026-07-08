"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Download,
  FileText,
  FolderOpen,
  MessageSquare,
  PlusCircle,
  RotateCcw,
  Square,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/status-badge";
import {
  CopyButton,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatReadableEnum,
  formatRelativeDateTime,
  formatRunDuration,
  shortIdentifier,
} from "@/components/task-run-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isRunActive } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import { useCancelRun, useRunTaskNow } from "@/lib/queries";
import type { LogStream, RunDto, TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type RunDetailProps = {
  run: RunDto;
  task?: TaskDto;
};

type EventLine = {
  id: string;
  eventType: string;
  message: string;
  raw: string;
};

function parseEventLines(input: string): EventLine[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const eventType =
          typeof parsed.event_type === "string"
            ? parsed.event_type
            : typeof parsed.eventType === "string"
              ? parsed.eventType
              : "event";
        const message =
          typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.msg === "string"
              ? parsed.msg
              : line;
        return { id: `${index}-${eventType}`, eventType, message, raw: line };
      } catch {
        return { id: `${index}-raw`, eventType: "raw", message: line, raw: line };
      }
    });
}

function formatBytes(value: number | undefined) {
  if (!value) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

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
        {actions ? (
          <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetadataItem({
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

function PathValue({
  value,
  fallback = "Not recorded",
}: {
  value?: string;
  fallback?: string;
}) {
  if (!value) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
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

function TextBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5">
      {children}
    </pre>
  );
}

export function RunDetail({ run, task }: RunDetailProps) {
  const [logs, setLogs] = useState<Record<LogStream, string>>({
    stdout: "",
    stderr: "",
    events: "",
  });
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const cancelRun = useCancelRun();
  const runTaskNow = useRunTaskNow();
  const active = isRunActive(run.status);
  const eventLines = useMemo(() => parseEventLines(logs.events), [logs.events]);
  const workspaceToOpen = run.worktreePath ?? run.workspacePath;
  const artifacts = run.artifacts ?? [];

  useEffect(() => {
    let canceled = false;
    const cursors: Record<LogStream, number> = { stdout: 0, stderr: 0, events: 0 };
    setLogs({ stdout: "", stderr: "", events: "" });

    async function poll(stream: LogStream) {
      try {
        const result = await ipcClient.runTailLog({
          runId: run.id,
          stream,
          cursor: cursors[stream],
          limit: 16_384,
        });
        if (canceled) {
          return;
        }
        cursors[stream] = result.nextCursor;
        if (result.data) {
          setLogs((current) => ({
            ...current,
            [stream]: `${current[stream]}${result.data}`,
          }));
        }
      } catch {
        if (!canceled) {
          setLogs((current) => ({
            ...current,
            [stream]:
              current[stream] ||
              "Log tail is not available yet. The backend may not have created the log file.",
          }));
        }
      }
    }

    void poll("stdout");
    void poll("stderr");
    void poll("events");
    const interval = active
      ? window.setInterval(() => {
          void poll("stdout");
          void poll("stderr");
          void poll("events");
        }, 3_000)
      : undefined;

    return () => {
      canceled = true;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [active, run.id]);

  function cancel() {
    cancelRun
      .mutateAsync(run.id)
      .then(() => toast.success("Run canceled"))
      .catch((error) =>
        toast.error("Could not cancel run", {
          description:
            error instanceof Error ? error.message : "Scheduler command failed.",
        }),
      );
  }

  function rerun() {
    runTaskNow
      .mutateAsync(run.taskId)
      .then(() => toast.success("Retry queued"))
      .catch((error) =>
        toast.error("Could not queue retry", {
          description:
            error instanceof Error ? error.message : "Scheduler command failed.",
        }),
      );
  }

  function openPath(path: string, label: string) {
    ipcClient
      .openPath(path)
      .then(() => toast.success(`Opened ${label} in Finder`))
      .catch((error) =>
        toast.error(`Could not open ${label}`, {
          description:
            error instanceof Error ? error.message : "Open path command failed.",
        }),
      );
  }

  async function exportLogs() {
    setIsExportingLogs(true);
    try {
      const path = await ipcClient.exportRunLogs(run.id);
      if (path) {
        toast.success("Logs exported", { description: path });
      }
    } catch (error) {
      toast.error("Could not export logs", {
        description:
          error instanceof Error ? error.message : "Export command failed.",
      });
    } finally {
      setIsExportingLogs(false);
    }
  }

  const stdoutText = logs.stdout || run.stdoutTail || "";
  const stderrText = logs.stderr || run.stderrTail || "";
  const eventsText = logs.events || "";
  const outputText = run.resultSummary || "";
  const promptText = task?.prompt.body || "";
  const target = task
    ? describeTaskTarget(task)
    : {
        label: formatReadableEnum(run.targetMode),
        detail: run.workspacePath ?? run.worktreePath,
      };
  const startedAt = run.startedAt ?? run.queuedAt ?? run.scheduledFor;
  const hasStatusReason = Boolean(run.statusReason);

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-lg border bg-surface/70 p-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-balance">
                {task?.name ?? run.taskId}
              </h2>
              <RunStatusBadge status={run.status} />
              <Badge variant="outline">{formatReadableEnum(run.triggerType)}</Badge>
            </div>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {run.id}
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 xl:w-auto xl:justify-end">
            {workspaceToOpen ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => openPath(workspaceToOpen, "workspace")}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Open workspace
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link
                href={`/tasks/new?prefillFromTask=${encodeURIComponent(run.taskId)}&sourceRun=${encodeURIComponent(run.id)}`}
              >
                <PlusCircle className="size-4" aria-hidden="true" />
                Create follow-up task
              </Link>
            </Button>
            {active ? (
              <Button variant="outline" disabled={cancelRun.isPending} onClick={cancel}>
                <Square className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
            <Button variant="outline" disabled={runTaskNow.isPending} onClick={rerun}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetadataItem
            label="Started"
            value={
              <span className="tabular-nums">
                {formatRelativeDateTime(startedAt, "Not started")}
              </span>
            }
            detail={formatAbsoluteDateTime(startedAt, "Not started")}
          />
          <MetadataItem
            label="Duration"
            value={<span className="tabular-nums">{formatRunDuration(run)}</span>}
            detail={run.exitCode === undefined ? "Exit not recorded" : `Exit ${run.exitCode}`}
          />
          <MetadataItem
            label="Target"
            value={target.label}
            detail={
              <span className="block truncate font-mono" title={target.detail}>
                {target.detail ?? "Not recorded"}
              </span>
            }
          />
          <MetadataItem
            label="Workspace"
            value={<PathValue value={run.workspacePath} />}
          />
          <MetadataItem
            label="Worktree"
            value={<PathValue value={run.worktreePath} />}
          />
          <MetadataItem
            label="Branch"
            value={
              <span className="block truncate font-mono text-xs" title={run.branchName}>
                {run.branchName ?? "Not recorded"}
              </span>
            }
            detail={`Base ${run.baseRef ?? "default"}`}
          />
          <MetadataItem
            label="Commit before"
            value={<span className="font-mono text-xs">{shortIdentifier(run.commitBefore)}</span>}
          />
          <MetadataItem
            label="Commit after"
            value={<span className="font-mono text-xs">{shortIdentifier(run.commitAfter)}</span>}
          />
          <MetadataItem
            label="Scheduled"
            value={
              <span className="tabular-nums">
                {formatAbsoluteDateTime(run.scheduledFor)}
              </span>
            }
          />
        </dl>
      </section>

      <DetailSection
        title="Prompt"
        description="Instruction used by the task when this run was queued."
        icon={FileText}
        actions={<CopyButton value={promptText} toastLabel="Prompt" />}
      >
        {promptText ? (
          <TextBlock>{promptText}</TextBlock>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Prompt text is unavailable for this run.
          </p>
        )}
      </DetailSection>

      <DetailSection
        title="Output"
        description="Assistant final message and run review counters."
        icon={MessageSquare}
        actions={<CopyButton value={outputText} toastLabel="Output" />}
      >
        <div className="grid gap-3">
          {outputText ? (
            <div className="rounded-md bg-background p-3 text-sm leading-6 text-pretty">
              {outputText}
            </div>
          ) : (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              No final message has been recorded yet.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Findings {run.findingsCount ?? 0}</Badge>
            <Badge variant="outline">
              Created schedules {run.createdScheduleCount ?? 0}
            </Badge>
            {run.codexSessionId ? (
              <Badge variant="muted" className="font-mono">
                {run.codexSessionId}
              </Badge>
            ) : null}
          </div>
          {hasStatusReason ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {run.statusReason}
            </div>
          ) : null}
        </div>
      </DetailSection>

      <DetailSection
        title="Logs"
        description="stdout, stderr, and event JSONL are tailed while the run is active."
        icon={TerminalSquare}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isExportingLogs}
            onClick={() => void exportLogs()}
          >
            <Download className="size-4" aria-hidden="true" />
            Export logs
          </Button>
        }
      >
        <Tabs defaultValue="stdout">
          <TabsList>
            <TabsTrigger value="stdout">stdout</TabsTrigger>
            <TabsTrigger value="stderr">stderr</TabsTrigger>
            <TabsTrigger value="events">events</TabsTrigger>
          </TabsList>
          <TabsContent value="stdout" className="grid gap-2">
            <div className="flex justify-end">
              <CopyButton value={stdoutText} toastLabel="stdout" />
            </div>
            <TextBlock>{stdoutText || "No stdout yet."}</TextBlock>
          </TabsContent>
          <TabsContent value="stderr" className="grid gap-2">
            <div className="flex justify-end">
              <CopyButton value={stderrText} toastLabel="stderr" />
            </div>
            <TextBlock>{stderrText || "No stderr yet."}</TextBlock>
          </TabsContent>
          <TabsContent value="events" className="grid gap-2">
            <div className="flex justify-end">
              <CopyButton value={eventsText} toastLabel="Event log" />
            </div>
            <div className="min-h-64 rounded-md bg-muted p-3">
              {eventLines.length ? (
                <div className="grid gap-2">
                  {eventLines.map((event) => (
                    <div key={event.id} className="rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{formatReadableEnum(event.eventType)}</Badge>
                        <span className="text-pretty">{event.message}</span>
                      </div>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Raw event
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono leading-5">
                          {event.raw}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No events yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DetailSection>

      <DetailSection
        title="Artifacts"
        description="Files recorded by the completed run."
        icon={FolderOpen}
      >
        {artifacts.length ? (
          <div className="grid gap-2">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex flex-col justify-between gap-3 rounded-md border p-3 xl:flex-row xl:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{formatReadableEnum(artifact.kind)}</Badge>
                    <span className="font-medium">
                      {artifact.title ?? artifact.path}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {artifact.path}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(artifact.sizeBytes)} ·{" "}
                    {formatAbsoluteDateTime(artifact.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto xl:shrink-0"
                  onClick={() => openPath(artifact.path, "artifact")}
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                  Show in Finder
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No artifacts were recorded for this run.
          </p>
        )}
      </DetailSection>
    </div>
  );
}
