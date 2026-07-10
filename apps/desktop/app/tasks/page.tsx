"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarClock,
  CircleSlash,
  Folder,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Play,
  Repeat,
  Timer,
} from "lucide-react";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskDetail } from "@/components/task-detail";
import { TaskWizard } from "@/components/task-wizard";
import {
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatRunDuration,
} from "@/components/task-run-display";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ValueBadge } from "@/components/value-badge";
import { taskLastRun } from "@/lib/format";
import { useRuns, useTask, useTaskAudits, useTasks } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

function isArchivedTask(task: TaskDto) {
  return (
    task.status !== "active" ||
    task.kind === "manual" ||
    task.kind === "once" ||
    !task.nextRunAt
  );
}

function taskTargetIcon(task: TaskDto) {
  switch (task.target.mode) {
    case "chat":
      return MessageSquare;
    case "repo-worktree":
      return GitBranch;
    case "repo-local":
      return FolderGit2;
    default:
      return Folder;
  }
}

function taskScheduleIcon(task: TaskDto) {
  switch (task.kind) {
    case "manual":
      return Play;
    case "once":
      return CalendarClock;
    default:
      return Repeat;
  }
}

function TaskScreen({ taskId }: { taskId: string }) {
  const [editingTask, setEditingTask] = useState<TaskDto | undefined>();
  const task = useTask(taskId);
  const runs = useRuns({ taskId });
  const audits = useTaskAudits(taskId);

  if (task.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-16" />
        <Skeleton className="h-44" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!task.data) {
    return (
      <div className="rounded-lg border bg-surface/70 p-4 text-sm text-muted-foreground">
        タスクを読み込めませんでした。
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={task.data.name}
        description="このタスクの概要、実行履歴、プロンプト、設定、監査ログ、操作を確認します。"
      />
      <TaskDetail
        task={task.data}
        runs={runs.data ?? []}
        auditEvents={audits.data}
        onEdit={setEditingTask}
      />

      <Dialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => !open && setEditingTask(undefined)}
      >
        <DialogContent className="max-h-[90dvh] w-[min(96vw,1100px)] overflow-auto">
          <DialogHeader>
            <DialogTitle>タスクを編集</DialogTitle>
          </DialogHeader>
          {editingTask ? (
            <TaskWizard
              task={editingTask}
              cancelHref={`/tasks?task=${encodeURIComponent(editingTask.id)}`}
              onCancel={() => setEditingTask(undefined)}
              onSaved={() => setEditingTask(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TasksPageContent() {
  const searchParams = useSearchParams();
  const selectedTaskId = searchParams.get("task") ?? undefined;
  const tasks = useTasks();
  const runs = useRuns();
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];

  if (selectedTaskId) {
    return <TaskScreen taskId={selectedTaskId} />;
  }

  const archivedTasks = taskList.filter(isArchivedTask).sort((left, right) => {
    const leftRun = taskLastRun(left, runList);
    const rightRun = taskLastRun(right, runList);
    return (rightRun?.startedAt ?? rightRun?.scheduledFor ?? "").localeCompare(
      leftRun?.startedAt ?? leftRun?.scheduledFor ?? "",
    );
  });

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col gap-5">
      <PageHeader
        title="アーカイブ済み"
        description="停止中、完了済み、1回きりのタスクを確認します。"
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-surface/70">
          {archivedTasks.length ? (
            archivedTasks.map((task) => {
              const lastRun = taskLastRun(task, runList);
              const schedule = describeTaskSchedule(task);
              const target = describeTaskTarget(task);
              return (
                <Link
                  key={task.id}
                  href={`/tasks?task=${encodeURIComponent(task.id)}`}
                  className="grid gap-3 border-b p-4 transition-colors duration-150 last:border-b-0 hover:bg-muted/50"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {task.name}
                        </p>
                        <TaskStatusBadge status={task.status} />
                        <ValueBadge
                          icon={taskTargetIcon(task)}
                          label={target.label}
                          title={target.detail ?? target.label}
                          variant={
                            task.target.mode === "chat" ? "muted" : "info"
                          }
                        />
                      </div>
                      <p className="mt-1 line-clamp-1 max-w-3xl text-xs text-muted-foreground">
                        {target.detail ?? "アプリ管理ワークスペース"}
                      </p>
                    </div>
                    <div className="text-left text-xs text-muted-foreground sm:text-right">
                      <p>前回実行</p>
                      <p className="mt-1 tabular-nums">
                        {formatAbsoluteDateTime(
                          lastRun?.startedAt ?? lastRun?.scheduledFor,
                        )}
                      </p>
                    </div>
                  </div>

                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        スケジュール
                      </dt>
                      <dd className="mt-1">
                        <ValueBadge
                          icon={taskScheduleIcon(task)}
                          label={schedule.label}
                          title={schedule.detail ?? schedule.label}
                          variant={task.kind === "cron" ? "info" : "muted"}
                        />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        前回状態
                      </dt>
                      <dd className="mt-1">
                        {lastRun ? (
                          <RunStatusBadge status={lastRun.status} />
                        ) : (
                          <ValueBadge
                            icon={CircleSlash}
                            label="なし"
                            variant="muted"
                            title="実行履歴なし"
                          />
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        所要時間
                      </dt>
                      <dd className="mt-1">
                        <ValueBadge
                          icon={Timer}
                          label={lastRun ? formatRunDuration(lastRun) : "—"}
                          variant={lastRun ? "outline" : "muted"}
                          title={
                            lastRun ? "前回実行の所要時間" : "所要時間未記録"
                          }
                        />
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })
          ) : (
            <EmptyState
              icon={Folder}
              title="アーカイブ済みタスクはありません"
              description="停止中、完了済み、1回きりのタスクがここに表示されます。"
              className="flex-1 border-0"
              action={{ label: "新規タスク", href: "/tasks/new" }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground">
          タスクを読み込んでいます...
        </div>
      }
    >
      <TasksPageContent />
    </Suspense>
  );
}
