"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatDuration, isRunActive } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import { useCancelRun, useRunTaskNow } from "@/lib/queries";
import type { LogStream, RunDto, TaskDto } from "@/lib/types";

type RunDetailProps = {
  run: RunDto;
  task?: TaskDto;
};

export function RunDetail({ run, task }: RunDetailProps) {
  const [logs, setLogs] = useState<Record<LogStream, string>>({
    stdout: "",
    stderr: "",
  });
  const cancelRun = useCancelRun();
  const runTaskNow = useRunTaskNow();
  const active = isRunActive(run.status);

  useEffect(() => {
    let canceled = false;
    const cursors: Record<LogStream, number> = { stdout: 0, stderr: 0 };
    setLogs({ stdout: "", stderr: "" });

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
              "Log tail is not available yet. The backend may not have created log files.",
          }));
        }
      }
    }

    void poll("stdout");
    void poll("stderr");
    const interval = active
      ? window.setInterval(() => {
          void poll("stdout");
          void poll("stderr");
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
      .then(() => toast.success("Re-run queued"))
      .catch((error) =>
        toast.error("Could not queue re-run", {
          description:
            error instanceof Error ? error.message : "Scheduler command failed.",
        }),
      );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-base">{run.id}</CardTitle>
              <RunStatusBadge status={run.status} />
            </div>
            <CardDescription className="mt-2">
              {task?.name ?? run.taskId} · {run.triggerType}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {active ? (
              <Button variant="outline" disabled={cancelRun.isPending} onClick={cancel}>
                <Square className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
            <Button variant="outline" disabled={runTaskNow.isPending} onClick={rerun}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Re-run
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Scheduled for</span>
              <span className="tabular-nums">{formatDateTime(run.scheduledFor)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Started</span>
              <span className="tabular-nums">{formatDateTime(run.startedAt)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Duration</span>
              <span>{formatDuration(run)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Exit code</span>
              <span>{run.exitCode ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Workspace</span>
              <span className="max-w-96 truncate font-mono text-xs">
                {run.workspacePath ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Final message</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-pretty">
              {run.resultSummary || "No final message has been recorded yet."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">findings {run.findingsCount ?? 0}</Badge>
              <Badge variant="outline">
                created schedules {run.createdScheduleCount ?? 0}
              </Badge>
            </div>
            {run.statusReason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                {run.statusReason}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
          <CardDescription>stdout/stderr tail is cursor-polled while a run is active.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="stdout">
            <TabsList>
              <TabsTrigger value="stdout">stdout</TabsTrigger>
              <TabsTrigger value="stderr">stderr</TabsTrigger>
              <TabsTrigger value="events">events JSONL</TabsTrigger>
            </TabsList>
            <TabsContent value="stdout">
              <pre className="min-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-pretty">
                {logs.stdout || run.stdoutTail || "No stdout yet."}
              </pre>
            </TabsContent>
            <TabsContent value="stderr">
              <pre className="min-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-pretty">
                {logs.stderr || run.stderrTail || "No stderr yet."}
              </pre>
            </TabsContent>
            <TabsContent value="events">
              <pre className="min-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-pretty">
                Events JSONL tailing is pending a run_tail_log stream enum for events.
                TODO: wire this tab when the backend accepts stream=&quot;events&quot;.
              </pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
