"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, PlusCircle, RotateCcw, Square } from "lucide-react";
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

function shortValue(value: string | undefined) {
  return value ? value.slice(0, 12) : "—";
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
              "ログ末尾はまだ取得できません。バックエンドがログファイルを作成していない可能性があります。",
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
      .then(() => toast.success("run をキャンセルしました"))
      .catch((error) =>
        toast.error("run をキャンセルできませんでした", {
          description:
            error instanceof Error ? error.message : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  function rerun() {
    runTaskNow
      .mutateAsync(run.taskId)
      .then(() => toast.success("再実行をキューに入れました"))
      .catch((error) =>
        toast.error("再実行をキューに入れられませんでした", {
          description:
            error instanceof Error ? error.message : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  function openPath(path: string, label: string) {
    ipcClient
      .openPath(path)
      .then(() => toast.success(`${label}を Finder で開きました`))
      .catch((error) =>
        toast.error(`${label}を開けませんでした`, {
          description:
            error instanceof Error ? error.message : "パスを開くコマンドに失敗しました。",
        }),
      );
  }

  async function exportLogs() {
    setIsExportingLogs(true);
    try {
      const path = await ipcClient.exportRunLogs(run.id);
      if (path) {
        toast.success("ログを書き出しました", { description: path });
      }
    } catch (error) {
      toast.error("ログを書き出せませんでした", {
        description:
          error instanceof Error ? error.message : "書き出しコマンドに失敗しました。",
      });
    } finally {
      setIsExportingLogs(false);
    }
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
          <div className="flex flex-wrap gap-2">
            {workspaceToOpen ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => openPath(workspaceToOpen, "ワークスペース")}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                ワークスペースを開く
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link
                href={`/tasks/new?prefillFromTask=${encodeURIComponent(run.taskId)}&sourceRun=${encodeURIComponent(run.id)}`}
              >
                <PlusCircle className="size-4" aria-hidden="true" />
                フォローアップタスクを作成
              </Link>
            </Button>
            {active ? (
              <Button variant="outline" disabled={cancelRun.isPending} onClick={cancel}>
                <Square className="size-4" aria-hidden="true" />
                キャンセル
              </Button>
            ) : null}
            <Button variant="outline" disabled={runTaskNow.isPending} onClick={rerun}>
              <RotateCcw className="size-4" aria-hidden="true" />
              再実行
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>メタデータ</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">予定時刻</span>
              <span className="tabular-nums">{formatDateTime(run.scheduledFor)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">開始</span>
              <span className="tabular-nums">{formatDateTime(run.startedAt)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">所要時間</span>
              <span>{formatDuration(run)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">終了コード</span>
              <span>{run.exitCode ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">ワークスペース</span>
              <span className="max-w-96 truncate font-mono text-xs">
                {run.workspacePath ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">worktree</span>
              <span className="max-w-96 truncate font-mono text-xs">
                {run.worktreePath ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">ブランチ</span>
              <span className="max-w-96 truncate font-mono text-xs">
                {run.branchName ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">base ref</span>
              <span className="font-mono text-xs">{run.baseRef ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">変更前 commit</span>
              <span className="font-mono text-xs">{shortValue(run.commitBefore)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">変更後 commit</span>
              <span className="font-mono text-xs">{shortValue(run.commitAfter)}</span>
            </div>
            {/* TODO: Show codexCommandJson here when RunDto exposes it. */}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最終メッセージ</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-pretty">
              {run.resultSummary || "最終メッセージはまだ記録されていません。"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">findings {run.findingsCount ?? 0}</Badge>
              <Badge variant="outline">
                作成 schedule {run.createdScheduleCount ?? 0}
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
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>ログ</CardTitle>
            <CardDescription>
              run が active の間、stdout/stderr/events の末尾を cursor でポーリングします。
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isExportingLogs}
            onClick={() => void exportLogs()}
          >
            <Download className="size-4" aria-hidden="true" />
            ログを書き出す
          </Button>
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
                {logs.stdout || run.stdoutTail || "stdout はまだありません。"}
              </pre>
            </TabsContent>
            <TabsContent value="stderr">
              <pre className="min-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-pretty">
                {logs.stderr || run.stderrTail || "stderr はまだありません。"}
              </pre>
            </TabsContent>
            <TabsContent value="events">
              <div className="min-h-64 overflow-auto rounded-md bg-muted p-3">
                {eventLines.length ? (
                  <div className="grid gap-2">
                    {eventLines.map((event) => (
                      <div key={event.id} className="rounded-md border bg-background p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline">{event.eventType}</Badge>
                          <span className="text-pretty">{event.message}</span>
                        </div>
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            未加工 JSON
                          </summary>
                          <pre className="mt-2 overflow-auto rounded bg-muted p-2">
                            {event.raw}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">events はまだありません。</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>成果物</CardTitle>
          <CardDescription>完了した run が記録したファイルです。</CardDescription>
        </CardHeader>
        <CardContent>
          {artifacts.length ? (
            <div className="grid gap-2">
              {artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex flex-col justify-between gap-3 rounded-md border p-3 md:flex-row md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{artifact.kind}</Badge>
                      <span className="font-medium">
                        {artifact.title ?? artifact.path}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {artifact.path}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(artifact.sizeBytes)} · {formatDateTime(artifact.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openPath(artifact.path, "成果物")}
                  >
                    <FolderOpen className="size-4" aria-hidden="true" />
                    Finder で表示
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              この run に記録された成果物はありません。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
