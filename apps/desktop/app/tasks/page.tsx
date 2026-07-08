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

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(400px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Task list</CardTitle>
            <CardDescription>
              {taskList.length.toLocaleString("ja-JP")} tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            {taskList.length ? (
              <Table className="min-w-[960px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[250px]">Name</TableHead>
                    <TableHead className="w-[88px]">Kind</TableHead>
                    <TableHead className="w-[150px]">Schedule</TableHead>
                    <TableHead className="w-[140px]">Next run</TableHead>
                    <TableHead className="w-[116px]">Last result</TableHead>
                    <TableHead className="w-[104px]">Status</TableHead>
                    <TableHead className="w-[112px] text-right">Actions</TableHead>
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
                        <TableCell className="w-[250px]">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={`/tasks?task=${task.id}`}
                              className="truncate font-medium hover:underline"
                            >
                              {task.name}
                            </Link>
                            {task.codex.sandboxMode === "danger-full-access" ? (
                              <Badge variant="warning">
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                Full access
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                            {task.description || formatTargetMode(task.target.mode)}
                          </p>
                        </TableCell>
                        <TableCell className="w-[88px]">{formatTaskKind(task.kind)}</TableCell>
                        <TableCell className="w-[150px] truncate">
                          {formatTaskSchedule(task)}
                        </TableCell>
                        <TableCell className="w-[140px] tabular-nums">
                          {formatDateTime(task.nextRunAt)}
                        </TableCell>
                        <TableCell className="w-[116px]">
                          {lastRun ? (
                            <RunStatusBadge status={lastRun.status} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="w-[104px]">
                          <TaskStatusBadge status={task.status} />
                        </TableCell>
                        <TableCell className="w-[112px] text-right">
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
                title="No tasks yet"
                description="Create the recurring or manual Codex work you want to schedule."
                action={{ label: "New task", href: "/tasks/new" }}
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
                <CardTitle>Task detail</CardTitle>
                <CardDescription>Loading the selected task.</CardDescription>
              </CardHeader>
            </Card>
          )
        ) : (
          <EmptyState
            icon={ListTodo}
            title="Select a task"
            description="Select a task to inspect its prompt, policies, runs, and audit events."
          />
        )}
      </div>

      <Dialog open={Boolean(editingTask)} onOpenChange={(open) => !open && setEditingTask(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
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
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading tasks...</div>}>
      <TasksPageContent />
    </Suspense>
  );
}
