"use client";

import {
  ChevronDown,
  Copy,
  LockKeyhole,
  LockOpen,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppLink } from "@/components/app-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  useDeleteTask,
  usePauseTask,
  useResumeTask,
  useRunTaskNow,
  useUpdateTask,
} from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

type TaskHeaderActionsProps = {
  task: TaskDto;
  onDeleted?: (task: TaskDto) => void;
};

export function TaskHeaderActions({
  task,
  onDeleted,
}: TaskHeaderActionsProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const runNow = useRunTaskNow();
  const pause = usePauseTask();
  const resume = useResumeTask();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const canPause = task.status === "active";
  const canResume = task.status === "paused" || task.status === "completed";

  function withToast<T>(
    promise: Promise<T>,
    success: string,
    failure: string,
    onSuccess?: () => void,
  ) {
    promise
      .then(() => {
        toast.success(success);
        onSuccess?.();
      })
      .catch((error) =>
        toast.error(failure, {
          description:
            error instanceof Error
              ? error.message
              : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  function runTaskNow() {
    withToast(
      runNow.mutateAsync(task.id),
      "実行をキューに追加しました",
      "実行をキューに追加できませんでした",
    );
  }

  function pauseTask() {
    withToast(
      pause.mutateAsync(task.id),
      "タスクを一時停止しました",
      "タスクを一時停止できませんでした",
    );
  }

  function resumeTask() {
    withToast(
      resume.mutateAsync(task.id),
      "タスクを再開しました",
      "タスクを再開できませんでした",
    );
  }

  function toggleLock() {
    withToast(
      updateTask.mutateAsync({ ...task, locked: !task.locked }),
      task.locked
        ? "タスクのロックを解除しました"
        : "タスクをロックしました",
      "ロック状態を更新できませんでした",
    );
  }

  function deleteCurrentTask() {
    withToast(
      deleteTask.mutateAsync(task.id),
      "タスクを削除しました",
      "タスクを削除できませんでした",
      () => onDeleted?.(task),
    );
  }

  const managementLabel = task.locked
    ? `${task.name}の管理（ロック中）`
    : `${task.name}の管理`;

  return (
    <div
      role="group"
      aria-label={`${task.name}の操作`}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <div
        role="group"
        aria-label={`${task.name}の実行操作`}
        className="flex items-center gap-2"
      >
        <Button
          size="sm"
          aria-label={`${task.name}を今すぐ実行`}
          disabled={runNow.isPending || task.status === "deleted"}
          onClick={runTaskNow}
        >
          <Play data-icon="inline-start" aria-hidden="true" />
          今すぐ実行
        </Button>

        {canPause ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${task.name}を一時停止`}
            disabled={pause.isPending}
            onClick={pauseTask}
          >
            <Pause data-icon="inline-start" aria-hidden="true" />
            一時停止
          </Button>
        ) : canResume ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${task.name}を再開`}
            disabled={resume.isPending}
            onClick={resumeTask}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            再開
          </Button>
        ) : null}
      </div>

      <Separator
        role="separator"
        aria-orientation="vertical"
        className="hidden h-5 w-px sm:block"
      />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={managementLabel}
          >
            {task.locked ? (
              <LockKeyhole data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Settings2 data-icon="inline-start" aria-hidden="true" />
            )}
            管理
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>タスク管理</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <AppLink
                href={`/tasks/new?duplicateFromTask=${encodeURIComponent(task.id)}`}
                aria-label={`${task.name}を複製`}
              >
                <Copy aria-hidden="true" />
                複製
              </AppLink>
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-label={
                task.locked
                  ? `${task.name}のロックを解除`
                  : `${task.name}をロック`
              }
              disabled={updateTask.isPending}
              onSelect={toggleLock}
            >
              {task.locked ? (
                <LockOpen aria-hidden="true" />
              ) : (
                <LockKeyhole aria-hidden="true" />
              )}
              {task.locked ? "ロックを解除" : "ロック"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              aria-label={`${task.name}を削除`}
              disabled={task.status === "deleted"}
              onSelect={() => setDeleteDialogOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              削除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>このタスクを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {task.name} は有効なスケジュールから削除されます。既存の実行履歴は引き続き利用できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteCurrentTask}
            >
              タスクを削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
