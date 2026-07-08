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
import {
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatCount,
  formatRelativeDateTime,
  formatRunDuration,
} from "@/components/task-run-display";
import { TaskWizard } from "@/components/task-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { taskLastRun } from "@/lib/format";
import { useRuns, useTask, useTaskAudits, useTasks } from "@/lib/queries";
import { taskStatuses, type TaskDto, type TaskStatus } from "@/lib/types";

function TaskRow({
  task,
  lastRun,
  isSelected,
  onEdit,
}: {
  task: TaskDto;
  lastRun?: ReturnType<typeof taskLastRun>;
  isSelected: boolean;
  onEdit: (task: TaskDto) => void;
}) {
  const schedule = describeTaskSchedule(task);
  const target = describeTaskTarget(task);
  const hasFullAccess = task.codex.sandboxMode === "danger-full-access";

  return (
    <div
      data-state={isSelected ? "selected" : undefined}
      className="grid gap-3 border-b p-4 transition-colors duration-150 last:border-b-0 hover:bg-muted/50 data-[state=selected]:bg-accent data-[state=selected]:text-accent-foreground"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/tasks?task=${task.id}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {task.name}
            </Link>
            <Badge variant="outline">{target.label}</Badge>
            {hasFullAccess ? (
              <Badge variant="warning">
                <AlertTriangle className="size-3" aria-hidden="true" />
                Full access
              </Badge>
            ) : null}
          </div>
          <p
            className="mt-1 line-clamp-1 max-w-3xl text-xs text-muted-foreground"
            title={target.detail}
          >
            {task.description || target.detail}
          </p>
        </div>
        <TaskRowActions task={task} onEdit={onEdit} className="shrink-0 justify-start sm:justify-end" />
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Schedule</dt>
          <dd className="mt-1 truncate font-medium">{schedule.label}</dd>
          {schedule.detail ? (
            <dd className="mt-0.5 truncate text-xs text-muted-foreground">
              {schedule.detail}
            </dd>
          ) : null}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-1">
            <TaskStatusBadge status={task.status} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Next run</dt>
          <dd className="mt-1 truncate font-medium tabular-nums">
            {formatRelativeDateTime(task.nextRunAt)}
          </dd>
          <dd className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
            {formatAbsoluteDateTime(task.nextRunAt)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Last run</dt>
          <dd className="mt-1 flex min-w-0 items-center gap-2">
            {lastRun ? (
              <>
                <RunStatusBadge status={lastRun.status} />
                <span className="truncate text-xs text-muted-foreground">
                  {formatRunDuration(lastRun)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No runs yet</span>
            )}
          </dd>
          {lastRun ? (
            <dd className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
              {formatAbsoluteDateTime(lastRun.startedAt ?? lastRun.scheduledFor)}
            </dd>
          ) : null}
        </div>
      </dl>
    </div>
  );
}

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
        title="Tasks"
        description="Manage Codex schedules, execution targets, and safety policies."
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
                <SelectItem value="all">All statuses</SelectItem>
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
                New task
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4">
        <section className="grid min-w-0 gap-3">
          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
            <div>
              <h2 className="text-base font-semibold text-balance">Task list</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatCount(taskList.length)}{" "}
                {taskList.length === 1 ? "task" : "tasks"} available. Select a task
                to inspect its prompt, policies, runs, and audit events.
              </p>
            </div>
          </div>

          <div className="overflow-visible rounded-lg border bg-surface/70">
            {taskList.length ? (
              taskList.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  lastRun={taskLastRun(task, runList)}
                  isSelected={selectedTaskId === task.id}
                  onEdit={setEditingTask}
                />
              ))
            ) : (
              <EmptyState
                icon={ListTodo}
                title="No tasks yet"
                description="Create the recurring or manual Codex work you want to schedule."
                action={{ label: "New task", href: "/tasks/new" }}
              />
            )}
          </div>
        </section>

        {selectedTaskId ? (
          selectedTask.data ? (
            <TaskDetail
              task={selectedTask.data}
              runs={runList}
              auditEvents={selectedTaskAudits.data}
              onEdit={setEditingTask}
            />
          ) : (
            <div className="rounded-lg border bg-surface/70 p-4 text-sm text-muted-foreground">
              Loading the selected task.
            </div>
          )
        ) : null}
      </div>

      <Dialog open={Boolean(editingTask)} onOpenChange={(open) => !open && setEditingTask(undefined)}>
        <DialogContent className="max-h-[90dvh] w-[min(96vw,1100px)] overflow-auto">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
          </DialogHeader>
          {editingTask ? (
            <TaskWizard
              task={editingTask}
              cancelHref="/tasks"
              onCancel={() => setEditingTask(undefined)}
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
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading tasks...</div>}>
      <TasksPageContent />
    </Suspense>
  );
}
