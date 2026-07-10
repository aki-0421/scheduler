"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FilePenLine,
  Globe2,
  MessageSquareCode,
  RotateCcw,
  Square,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/status-badge";
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

type RunDetailProps = {
  run: RunDto;
  task?: TaskDto;
};

type EventLogState = "loading" | "ready" | "unavailable";

const toolIcons: Record<string, LucideIcon> = {
  command_execution: Terminal,
  web_search: Globe2,
  file_change: FilePenLine,
  mcp_tool_call: Wrench,
};

const toolStatusPresentation: Record<
  ToolCallStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  running: {
    label: "実行中",
    icon: Clock3,
    className: "text-status-info-muted-foreground",
  },
  completed: {
    label: "完了",
    icon: Check,
    className: "text-status-success-muted-foreground",
  },
  failed: {
    label: "失敗",
    icon: X,
    className: "text-destructive",
  },
};

function MessageRow({
  icon: Icon,
  label,
  actions,
  children,
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  actions?: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-4">
      <div
        className="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground sm:size-9"
        aria-hidden="true"
      >
        <Icon />
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
          <p className="text-sm font-medium">{label}</p>
          {actions}
        </div>
        <div
          className={
            muted
              ? "rounded-lg bg-muted/60 px-4 py-3 text-sm leading-7"
              : "text-sm leading-7"
          }
        >
          {children}
        </div>
      </div>
    </li>
  );
}

function ToolRow({
  entry,
}: {
  entry: Extract<RunTranscriptEntry, { kind: "tool" }>;
}) {
  const ToolIcon = toolIcons[entry.itemType] ?? Wrench;
  const status = toolStatusPresentation[entry.status];
  const StatusIcon = status.icon;
  const summary = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ToolIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {entry.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm" title={entry.summary}>
        {entry.summary}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1.5 text-xs ${status.className}`}
      >
        <StatusIcon className="size-3.5" aria-hidden="true" />
        {status.label}
      </span>
    </div>
  );

  return (
    <li className="py-1 pl-11 sm:pl-[3.25rem]">
      {entry.details.length ? (
        <details className="group rounded-md border bg-muted/20 open:bg-muted/30">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
            {summary}
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div className="border-t px-3 py-3">
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
        <div className="flex min-h-10 items-center rounded-md border bg-muted/20 px-3 py-2">
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
    <li className="py-2 pl-11 sm:pl-[3.25rem]">
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
      run.resultSummary?.trim() ||
      (lastAssistant?.kind === "assistant" ? lastAssistant.text : "");

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
  const promptText = task?.prompt.body.trim() ?? "";
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
      try {
        const result = await ipcClient.runTailLog({
          runId: run.id,
          stream: "events",
          cursor,
          limit: 16_384,
        });
        if (canceled) {
          return;
        }
        cursor = result.nextCursor;
        if (result.data) {
          setEventLog((current) => `${current}${result.data}`);
        }
        setEventLogState("ready");
      } catch {
        if (!canceled) {
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
            <h1 className="truncate text-xl font-semibold tracking-tight text-balance">
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
          <div className="flex shrink-0 items-center gap-2">
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

      <ol role="log" aria-label="実行セッション">
        <MessageRow
          icon={MessageSquareCode}
          label="システムプロンプト"
          muted
          actions={
            promptText ? (
              <CopyButton
                value={promptText}
                label="コピー"
                toastLabel="システムプロンプト"
                variant="ghost"
              />
            ) : undefined
          }
        >
          <p className="whitespace-pre-wrap break-words text-pretty">
            {promptText || "この実行のシステムプロンプトは利用できません。"}
          </p>
        </MessageRow>

        {transcriptEntries.map((entry) => {
          if (entry.kind === "tool") {
            return <ToolRow key={entry.id} entry={entry} />;
          }
          if (entry.kind === "error") {
            return <ErrorRow key={entry.id} entry={entry} />;
          }
          return (
            <MessageRow key={entry.id} icon={Bot} label="Codex">
              <p className="whitespace-pre-wrap break-words text-pretty">
                {entry.text}
              </p>
            </MessageRow>
          );
        })}

        {eventLogState === "loading" ? (
          <li className="py-4 pl-11 text-sm text-muted-foreground sm:pl-[3.25rem]">
            ツール呼び出しを読み込んでいます…
          </li>
        ) : !hasToolEntries ? (
          <li className="py-4 pl-11 text-sm text-muted-foreground sm:pl-[3.25rem]">
            {eventLogState === "unavailable"
              ? "ツール呼び出しの記録を読み込めませんでした。"
              : "この実行にはツール呼び出しの記録がありません。"}
          </li>
        ) : null}

        {run.statusReason &&
        !transcriptEntries.some((entry) => entry.kind === "error") ? (
          <li className="flex items-start gap-3 py-4 pl-11 text-sm text-destructive sm:pl-[3.25rem]">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="text-pretty">{run.statusReason}</p>
          </li>
        ) : null}

        <MessageRow
          icon={Bot}
          label="最終出力"
          actions={
            finalOutput ? (
              <CopyButton
                value={finalOutput}
                label="コピー"
                toastLabel="最終出力"
                variant="ghost"
              />
            ) : undefined
          }
        >
          <p className="whitespace-pre-wrap break-words text-pretty">
            {active
              ? "実行中です。最終出力を待っています。"
              : finalOutput || "最終出力は記録されていません。"}
          </p>
        </MessageRow>
      </ol>
    </section>
  );
}
