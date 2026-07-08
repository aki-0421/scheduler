"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Folder } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="grid gap-5">
      <PageHeader
        title="アーカイブ済み"
        description="停止中、完了済み、1回きりのタスクを確認します。"
      />

      <section className="grid min-w-0 gap-3">
        <div className="overflow-hidden rounded-lg border bg-surface/70">
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
                        <Badge variant="outline">{target.label}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 max-w-3xl text-xs text-muted-foreground">
                        {task.description || target.detail}
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
                      <dd className="mt-1 truncate font-medium">
                        {schedule.label}
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
                          "実行履歴なし"
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        所要時間
                      </dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {lastRun ? formatRunDuration(lastRun) : "—"}
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
