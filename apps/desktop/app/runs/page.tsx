"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunDetail } from "@/components/run-detail";
import { formatRunStatus, RunStatusBadge } from "@/components/status-badge";
import {
  formatAbsoluteDateTime,
  formatReadableEnum,
  formatRelativeDateTime,
  formatRunDuration,
} from "@/components/task-run-display";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRun, useRuns, useTasks } from "@/lib/queries";
import { runStatuses, type RunDto, type RunStatus } from "@/lib/types";

type RunPreset = "recent" | "failed" | "needs_attention";

function RunPresetButton({
  value,
  current,
  onSelect,
  children,
}: {
  value: RunPreset;
  current: RunPreset;
  onSelect: (value: RunPreset) => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={current === value ? "default" : "ghost"}
      onClick={() => onSelect(value)}
    >
      {children}
    </Button>
  );
}

function RunRow({
  run,
  taskName,
  isSelected,
}: {
  run: RunDto;
  taskName: string;
  isSelected: boolean;
}) {
  const startedAt = run.startedAt ?? run.queuedAt ?? run.scheduledFor;
  const needsAttention =
    ["failed", "timed_out", "interrupted"].includes(run.status) ||
    (run.findingsCount ?? 0) > 0 ||
    (run.createdScheduleCount ?? 0) > 0;

  return (
    <Link
      href={`/runs?run=${encodeURIComponent(run.id)}`}
      data-state={isSelected ? "selected" : undefined}
      className="grid gap-3 border-b p-4 transition-colors duration-150 last:border-b-0 hover:bg-muted/50 data-[state=selected]:bg-accent data-[state=selected]:text-accent-foreground"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{taskName}</p>
            <RunStatusBadge status={run.status} />
            {needsAttention ? (
              <span className="rounded-md bg-status-warning-muted px-2 py-0.5 text-xs font-medium text-status-warning-muted-foreground">
                要確認
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {run.id}
          </p>
        </div>
        <div className="text-left text-sm sm:text-right">
          <p className="font-medium tabular-nums">
            {formatRelativeDateTime(startedAt, "未開始")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatAbsoluteDateTime(startedAt, "未開始")}
          </p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">トリガー</dt>
          <dd className="mt-1 truncate font-medium">
            {formatReadableEnum(run.triggerType)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">予定時刻</dt>
          <dd className="mt-1 truncate tabular-nums">
            {formatAbsoluteDateTime(run.scheduledFor)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">所要時間</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatRunDuration(run)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">終了コード</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {run.exitCode ?? "—"}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

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
      (
        right.startedAt ??
        right.scheduledFor ??
        right.queuedAt ??
        ""
      ).localeCompare(
        left.startedAt ?? left.scheduledFor ?? left.queuedAt ?? "",
      ),
    );
  const displayedRunList = sortedRunList.filter((run) => {
    if (preset === "failed") {
      return run.status === "failed";
    }
    if (preset === "needs_attention") {
      return (
        ["failed", "timed_out", "interrupted"].includes(run.status) ||
        (run.findingsCount ?? 0) > 0 ||
        (run.createdScheduleCount ?? 0) > 0
      );
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
      <PageHeader
        title="実行履歴"
        className="md:flex-col md:items-stretch xl:flex-row xl:items-start"
        actions={
          <>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setPreset("recent");
                setStatusFilter(value as RunStatus | "all");
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべての状態</SelectItem>
                {runStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatRunStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={taskFilter} onValueChange={setTaskFilter}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべてのタスク</SelectItem>
                {taskList.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      <div className="grid gap-4">
        <section className="grid min-w-0 gap-3">
          <div className="flex justify-end">
            <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
              <div className="flex rounded-md border bg-background p-1">
                <RunPresetButton
                  value="recent"
                  current={preset}
                  onSelect={applyPreset}
                >
                  最近
                </RunPresetButton>
                <RunPresetButton
                  value="failed"
                  current={preset}
                  onSelect={applyPreset}
                >
                  失敗
                </RunPresetButton>
                <RunPresetButton
                  value="needs_attention"
                  current={preset}
                  onSelect={applyPreset}
                >
                  要確認
                </RunPresetButton>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border bg-surface/70">
            {displayedRunList.length ? (
              displayedRunList.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  taskName={taskById.get(run.taskId)?.name ?? run.taskId}
                  isSelected={selectedRunId === run.id}
                />
              ))
            ) : (
              <EmptyState
                icon={Activity}
                title="一致する実行はありません"
                description="フィルターを解除するか、タスクを手動実行すると履歴が表示されます。"
                action={{ label: "タスクを開く", href: "/tasks" }}
              />
            )}
            {/* TODO: Add mark reviewed/archive actions when the DB schema supports triage state. */}
          </div>
        </section>

        {selectedRunId ? (
          selectedRun.data ? (
            <RunDetail
              run={selectedRun.data}
              task={taskById.get(selectedRun.data.taskId)}
            />
          ) : (
            <div className="rounded-lg border bg-surface/70 p-4 text-sm text-muted-foreground">
              選択した実行を読み込んでいます。
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground">
          実行履歴を読み込んでいます...
        </div>
      }
    >
      <RunsPageContent />
    </Suspense>
  );
}
