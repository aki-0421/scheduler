"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  CircleSlash,
  Folder,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Play,
  Repeat,
} from "lucide-react";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskHeaderActions } from "@/components/task-actions";
import { TaskDetail } from "@/components/task-detail";
import {
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatRunDuration,
} from "@/components/task-run-display";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ValueBadge } from "@/components/value-badge";
import { taskLastRun } from "@/lib/format";
import { useRuns, useTask, useTasks } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

function isArchivedTask(task: TaskDto) {
  return (
    task.status !== "active" ||
    task.kind === "manual" ||
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
  const router = useRouter();
  const task = useTask(taskId);
  const runs = useRuns({ taskId });

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
      <div className="py-4 text-sm text-muted-foreground">
        タスクを読み込めませんでした。
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={task.data.name}
        description="このタスクの実行履歴を確認し、設定と操作を管理します。"
        actions={
          <TaskHeaderActions
            task={task.data}
            onDeleted={() => router.push("/tasks?view=archived")}
          />
        }
      />
      <TaskDetail task={task.data} runs={runs.data ?? []} />
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
        description="停止中、完了済み、手動実行のタスクを確認します。"
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {archivedTasks.length ? (
          <div className="min-w-0 border-y">
            <Table className="min-w-[976px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">タスク</TableHead>
                  <TableHead className="w-48">実行先</TableHead>
                  <TableHead className="w-44">スケジュール</TableHead>
                  <TableHead className="w-28">前回状態</TableHead>
                  <TableHead className="w-36">前回実行</TableHead>
                  <TableHead className="w-24">所要時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archivedTasks.map((task) => {
                  const lastRun = taskLastRun(task, runList);
                  const schedule = describeTaskSchedule(task);
                  const target = describeTaskTarget(task);
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/tasks?task=${encodeURIComponent(task.id)}`}
                            title={task.name}
                            className="min-w-0 truncate rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {task.name}
                          </Link>
                          <TaskStatusBadge status={task.status} />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <ValueBadge
                          icon={taskTargetIcon(task)}
                          label={target.label}
                          title={target.detail ?? target.label}
                          variant={
                            task.target.mode === "chat" ? "muted" : "info"
                          }
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <ValueBadge
                          icon={taskScheduleIcon(task)}
                          label={schedule.label}
                          title={schedule.detail ?? schedule.label}
                          variant={task.kind === "cron" ? "info" : "muted"}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
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
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatAbsoluteDateTime(
                          lastRun?.startedAt ?? lastRun?.scheduledFor,
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {lastRun ? formatRunDuration(lastRun) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            icon={Folder}
            title="アーカイブ済みタスクはありません"
            description="停止中、完了済み、手動実行のタスクがここに表示されます。"
            className="flex-1 border-0"
            action={{ label: "新規タスク", href: "/tasks/new" }}
          />
        )}
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
