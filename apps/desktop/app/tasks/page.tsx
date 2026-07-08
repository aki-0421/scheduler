"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ListTodo, Plus } from "lucide-react";
import { Suspense, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  formatTaskStatus,
  RunStatusBadge,
  TaskStatusBadge,
} from "@/components/status-badge";
import { TaskDetail } from "@/components/task-detail";
import { TaskRowActions } from "@/components/task-actions";
import { TaskWizard } from "@/components/task-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDateTime,
  formatTaskKind,
  formatTaskSchedule,
  formatTargetMode,
  taskLastRun,
} from "@/lib/format";
import { useRuns, useTask, useTaskAudits, useTasks } from "@/lib/queries";
import { taskStatuses, type TaskDto, type TaskStatus } from "@/lib/types";

function TasksPageContent() {
  const searchParams = useSearchParams();
  const selectedTaskId = searchParams.get("task") ?? undefined;
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [editingTask, setEditingTask] = useState<TaskDto | undefined>();
  const tasks = useTasks(statusFilter === "all" ? undefined : statusFilter);
  const runs = useRuns();
  const selectedTask = useTask(selectedTaskId);
  const selectedTaskAudits = useTaskAudits(selectedTaskId);
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="タスク"
        description="Codex のスケジュール、実行先、安全ポリシーを管理します。"
        actions={
          <>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as TaskStatus | "all")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべての状態</SelectItem>
                {taskStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatTaskStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild>
              <Link href="/tasks/new">
                <Plus className="size-4" aria-hidden="true" />
                新規タスク
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle>タスク一覧</CardTitle>
            <CardDescription>
              {taskList.length.toLocaleString("ja-JP")} 件のタスク
            </CardDescription>
          </CardHeader>
          <CardContent>
            {taskList.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead>種別</TableHead>
                    <TableHead>スケジュール</TableHead>
                    <TableHead>次回実行</TableHead>
                    <TableHead>直近結果</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taskList.map((task) => {
                    const lastRun = taskLastRun(task, runList);
                    return (
                      <TableRow
                        key={task.id}
                        data-state={selectedTaskId === task.id ? "selected" : undefined}
                      >
                        <TableCell className="min-w-56">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/tasks?task=${task.id}`}
                              className="font-medium hover:underline"
                            >
                              {task.name}
                            </Link>
                            {task.codex.sandboxMode === "danger-full-access" ? (
                              <Badge variant="warning" className="gap-1">
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                danger-full-access
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                            {task.description || formatTargetMode(task.target.mode)}
                          </p>
                        </TableCell>
                        <TableCell>{formatTaskKind(task.kind)}</TableCell>
                        <TableCell className="max-w-56 truncate">
                          {formatTaskSchedule(task)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDateTime(task.nextRunAt)}
                        </TableCell>
                        <TableCell>
                          {lastRun ? (
                            <RunStatusBadge status={lastRun.status} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <TaskStatusBadge status={task.status} />
                        </TableCell>
                        <TableCell>
                          <TaskRowActions task={task} onEdit={setEditingTask} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={ListTodo}
                title="まだタスクがありません"
                description="Codex に定期的に任せたい作業を作成しましょう。"
                action={{ label: "新規タスク", href: "/tasks/new" }}
              />
            )}
          </CardContent>
        </Card>

        {selectedTaskId ? (
          selectedTask.data ? (
            <TaskDetail
              task={selectedTask.data}
              runs={runList}
              auditEvents={selectedTaskAudits.data}
              onEdit={setEditingTask}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>タスク詳細</CardTitle>
                <CardDescription>選択したタスクを読み込んでいます。</CardDescription>
              </CardHeader>
            </Card>
          )
        ) : (
          <EmptyState
            icon={ListTodo}
            title="タスクを選択"
            description="テーブルからタスクを選択すると、prompt、ポリシー、run、監査イベントを確認できます。"
          />
        )}
      </div>

      <Dialog open={Boolean(editingTask)} onOpenChange={(open) => !open && setEditingTask(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>タスクを編集</DialogTitle>
          </DialogHeader>
          {editingTask ? (
            <TaskWizard
              task={editingTask}
              cancelHref="/tasks"
              onSaved={() => setEditingTask(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">タスクを読み込んでいます...</div>}>
      <TasksPageContent />
    </Suspense>
  );
}
