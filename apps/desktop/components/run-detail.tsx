"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FilePenLine,
  Globe2,
  RotateCcw,
  Square,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/status-badge";
import {
  TaskInfoSheet,
  TaskPromptDialog,
} from "@/components/run-task-context";
import {
  CopyButton,
  formatAbsoluteDateTime,
  shortIdentifier,
} from "@/components/task-run-display";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { isRunActive } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import { useCancelRun, useRunTaskNow } from "@/lib/queries";
import {
  parseRunTranscript,
  type RunTranscriptEntry,
  type ToolCallStatus,
} from "@/lib/run-transcript";
import type { RunDto, TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type RunDetailProps = {
  run: RunDto;
  task?: TaskDto;
};

type EventLogState = "loading" | "ready" | "unavailable";

const EVENT_LOG_CHUNK_SIZE = 16_384;

const toolIcons: Record<string, LucideIcon> = {
  command_execution: Terminal,
  web_search: Globe2,
  file_change: FilePenLine,
  mcp_tool_call: Wrench,
};

const toolStatusPresentation: Record<
  ToolCallStatus,
  { label: string; icon?: LucideIcon; className: string }
> = {
  running: {
    label: "実行中",
    icon: Clock3,
    className: "text-status-info-muted-foreground",
  },
  completed: {
    label: "完了",
    className: "text-muted-foreground",
  },
  failed: {
    label: "失敗",
    className: "text-status-error-muted-foreground",
  },
};

function ToolRow({
  entry,
}: {
  entry: Extract<RunTranscriptEntry, { kind: "tool" }>;
}) {
  const ToolIcon = toolIcons[entry.itemType] ?? Wrench;
  const status = toolStatusPresentation[entry.status];
  const StatusIcon = status.icon;
  const summary = (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
      <span
        role="img"
        aria-label={entry.label}
        title={entry.label}
        className="flex size-5 shrink-0 items-center justify-center"
      >
        <ToolIcon className="size-4" aria-hidden="true" />
      </span>
      <span
        className="min-w-0 w-fit max-w-full shrink truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-muted-foreground"
        title={entry.summary}
      >
        {entry.summary}
      </span>
      {entry.status !== "running" ? (
        <span className="sr-only">ステータス: {status.label}</span>
      ) : (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs",
            status.className,
          )}
        >
          {StatusIcon ? (
            <StatusIcon className="size-3.5" aria-hidden="true" />
          ) : null}
          {status.label}
        </span>
      )}
    </div>
  );

  const rowClassName = cn(
    "flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md px-1 py-1",
    entry.status === "failed"
      ? "bg-status-error-muted"
      : "hover:bg-muted/40",
  );

  return (
    <li className="py-0.5">
      {entry.details.length ? (
        <details className="group">
          <summary
            className={cn(
              rowClassName,
              "cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden",
            )}
          >
            {summary}
            <ChevronRight
              className="invisible size-4 shrink-0 text-muted-foreground group-hover:visible group-focus-within:visible group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div className="ml-6 mt-1 rounded-md bg-muted/30 px-3 py-3">
            <div className="grid gap-4">
              {entry.details.map((detail) => (
                <div key={detail.label} className="min-w-0">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {detail.label}
                  </p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-5 text-foreground">
                    {detail.value}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : (
        <div className={rowClassName}>
          {summary}
        </div>
      )}
    </li>
  );
}

function ErrorRow({
  entry,
}: {
  entry: Extract<RunTranscriptEntry, { kind: "error" }>;
}) {
  return (
    <li className="py-2">
      <details className="group rounded-md border border-status-error-border bg-status-error-muted">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-3 py-2 text-sm text-status-error-muted-foreground [&::-webkit-details-marker]:hidden">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-pretty">{entry.text}</span>
          <ChevronRight
            className="size-4 shrink-0 group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        {entry.details.length ? (
          <div className="border-t border-status-error-border px-3 py-3">
            {entry.details.map((detail) => (
              <pre
                key={detail.label}
                className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-5 text-foreground"
              >
                {detail.value}
              </pre>
            ))}
          </div>
        ) : null}
      </details>
    </li>
  );
}

export function RunDetail({ run, task }: RunDetailProps) {
  const [eventLog, setEventLog] = useState("");
  const [eventLogState, setEventLogState] =
    useState<EventLogState>("loading");
  const cancelRun = useCancelRun();
  const runTaskNow = useRunTaskNow();
  const active = isRunActive(run.status);
  const parsedEntries = useMemo(
    () => parseRunTranscript(eventLog),
    [eventLog],
  );

  const { transcriptEntries, finalOutput } = useMemo(() => {
    if (active) {
      return { transcriptEntries: parsedEntries, finalOutput: "" };
    }

    const lastAssistantIndex = parsedEntries.findLastIndex(
      (entry) => entry.kind === "assistant",
    );
    const lastAssistant =
      lastAssistantIndex >= 0 ? parsedEntries[lastAssistantIndex] : undefined;
    const output =
      (lastAssistant?.kind === "assistant" ? lastAssistant.text : "") ||
      run.resultSummary?.trim() ||
      "";

    return {
      transcriptEntries:
        lastAssistantIndex >= 0
          ? parsedEntries.filter((_, index) => index !== lastAssistantIndex)
          : parsedEntries,
      finalOutput: output,
    };
  }, [active, parsedEntries, run.resultSummary]);

  const hasToolEntries = transcriptEntries.some(
    (entry) => entry.kind === "tool",
  );
  const startedAt = run.startedAt ?? run.queuedAt ?? run.scheduledFor;

  useEffect(() => {
    let canceled = false;
    let cursor = 0;
    let polling = false;
    setEventLog("");
    setEventLogState("loading");

    async function poll() {
      if (polling) {
        return;
      }
      polling = true;
      let received = "";
      try {
        while (!canceled) {
          const previousCursor = cursor;
          const result = await ipcClient.runTailLog({
            runId: run.id,
            stream: "events",
            cursor,
            limit: EVENT_LOG_CHUNK_SIZE,
          });
          cursor = result.nextCursor;
          received += result.data;
          if (result.eof || result.nextCursor <= previousCursor) {
            break;
          }
        }
        if (canceled) {
          return;
        }
        if (received) {
          setEventLog((current) => `${current}${received}`);
        }
        setEventLogState("ready");
      } catch {
        if (!canceled) {
          if (received) {
            setEventLog((current) => `${current}${received}`);
          }
          setEventLogState("unavailable");
        }
      } finally {
        polling = false;
      }
    }

    void poll();
    const interval = active
      ? window.setInterval(() => void poll(), 3_000)
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
      .then(() => toast.success("実行をキャンセルしました"))
      .catch((error) =>
        toast.error("実行をキャンセルできませんでした", {
          description:
            error instanceof Error
              ? error.message
              : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  function rerun() {
    runTaskNow
      .mutateAsync(run.taskId)
      .then(() => toast.success("再実行をキューに追加しました"))
      .catch((error) =>
        toast.error("再実行をキューに追加できませんでした", {
          description:
            error instanceof Error
              ? error.message
              : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  return (
    <section className="mx-auto w-full max-w-4xl pb-12">
      <header className="pb-6">
        <Button variant="ghost" size="sm" className="-ml-3 mb-4" asChild>
          <Link href={`/tasks?task=${encodeURIComponent(run.taskId)}`}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            タスクへ戻る
          </Link>
        </Button>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-balance">
              {task?.name ?? run.taskId}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <RunStatusBadge status={run.status} />
              <time dateTime={startedAt} className="tabular-nums">
                {formatAbsoluteDateTime(startedAt, "未開始")}
              </time>
              <span className="font-mono" title={run.id}>
                {shortIdentifier(run.id)}
              </span>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <TaskInfoSheet task={task} />
            <TaskPromptDialog task={task} />
            {active ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelRun.isPending}
                onClick={cancel}
              >
                <Square data-icon="inline-start" aria-hidden="true" />
                キャンセル
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={runTaskNow.isPending}
                onClick={rerun}
              >
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                再実行
              </Button>
            )}
          </div>
        </div>
      </header>

      <Separator />

      <ol role="log" aria-label="実行セッション" className="pt-4">
        {transcriptEntries.map((entry) => {
          if (entry.kind === "tool") {
            return <ToolRow key={entry.id} entry={entry} />;
          }
          if (entry.kind === "error") {
            return <ErrorRow key={entry.id} entry={entry} />;
          }
          return (
            <li key={entry.id} aria-label="Codexの途中出力" className="py-4">
              <p className="max-w-3xl whitespace-pre-wrap break-words text-pretty text-sm leading-7">
                {entry.text}
              </p>
            </li>
          );
        })}

        {eventLogState === "loading" ? (
          <li className="py-4 text-sm text-muted-foreground">
            実行ログを読み込んでいます…
          </li>
        ) : !hasToolEntries ? (
          <li className="py-4 text-sm text-muted-foreground">
            {eventLogState === "unavailable"
              ? "ツール呼び出しの記録を読み込めませんでした。"
              : "この実行にはツール呼び出しの記録がありません。"}
          </li>
        ) : null}

        {run.statusReason &&
        !transcriptEntries.some((entry) => entry.kind === "error") ? (
          <li className="flex items-start gap-3 py-4 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="text-pretty">{run.statusReason}</p>
          </li>
        ) : null}

        <li
          aria-label="最終出力"
          className="mt-6 rounded-lg bg-muted px-4 py-4 sm:px-5"
        >
          <div className="flex items-start gap-4">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-pretty text-sm leading-7">
              {active
                ? "実行中です。最終出力を待っています。"
                : finalOutput || "最終出力は記録されていません。"}
            </p>
            {finalOutput ? (
              <CopyButton
                value={finalOutput}
                label="コピー"
                toastLabel="最終出力"
                variant="ghost"
              />
            ) : null}
          </div>
        </li>
      </ol>
    </section>
  );
}
