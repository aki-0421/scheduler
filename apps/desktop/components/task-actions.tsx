"use client";

import { Pencil, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  useDeleteTask,
  usePauseTask,
  useResumeTask,
  useRunTaskNow,
} from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

type TaskRowActionsProps = {
  task: TaskDto;
  onEdit?: (task: TaskDto) => void;
};

export function TaskRowActions({ task, onEdit }: TaskRowActionsProps) {
  const runNow = useRunTaskNow();
  const pause = usePauseTask();
  const resume = useResumeTask();
  const deleteTask = useDeleteTask();
  const canPause = task.status === "active";
  const canResume = task.status === "paused" || task.status === "completed";

  function withToast<T>(promise: Promise<T>, success: string, failure: string) {
    promise
      .then(() => toast.success(success))
      .catch((error) =>
        toast.error(failure, {
          description:
            error instanceof Error ? error.message : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  return (
    <div className="flex min-w-28 items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${task.name} を今すぐ実行`}
        disabled={runNow.isPending || task.status === "deleted"}
        onClick={() =>
          withToast(
            runNow.mutateAsync(task.id),
            "run をキューに入れました",
            "run をキューに入れられませんでした",
          )
        }
      >
        <Play className="size-4" aria-hidden="true" />
      </Button>
      {canPause ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${task.name} を一時停止`}
          disabled={pause.isPending}
          onClick={() =>
            withToast(
              pause.mutateAsync(task.id),
              "タスクを一時停止しました",
              "タスクを一時停止できませんでした",
            )
          }
        >
          <Pause className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${task.name} を再開`}
          disabled={!canResume || resume.isPending}
          onClick={() =>
            withToast(
              resume.mutateAsync(task.id),
              "タスクを再開しました",
              "タスクを再開できませんでした",
            )
          }
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${task.name} を編集`}
        onClick={() => onEdit?.(task)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${task.name} を削除`}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>タスクを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {task.name} を有効なスケジュールから削除します。既存の run 履歴は残ります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                withToast(
                  deleteTask.mutateAsync(task.id),
                  "タスクを削除しました",
                  "タスクを削除できませんでした",
                )
              }
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
