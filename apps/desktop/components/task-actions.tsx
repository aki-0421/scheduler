"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LockKeyhole, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  useDeleteTask,
  usePauseTask,
  useResumeTask,
  useRunTaskNow,
} from "@/lib/queries";
import type { TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type TaskRowActionsProps = {
  task: TaskDto;
  onEdit?: (task: TaskDto) => void;
  onDeleted?: (task: TaskDto) => void;
  className?: string;
};

export function TaskRowActions({ task, onEdit, onDeleted, className }: TaskRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const runNow = useRunTaskNow();
  const pause = usePauseTask();
  const resume = useResumeTask();
  const deleteTask = useDeleteTask();
  const canPause = task.status === "active" && !task.locked;
  const canResume = (task.status === "paused" || task.status === "completed") && !task.locked;

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
            error instanceof Error ? error.message : "スケジューラーコマンドに失敗しました。",
        }),
      );
  }

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setMenuPosition({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  function pauseTask() {
    closeMenu();
    withToast(
      pause.mutateAsync(task.id),
      "タスクを一時停止しました",
      "タスクを一時停止できませんでした",
    );
  }

  function resumeTask() {
    closeMenu();
    withToast(
      resume.mutateAsync(task.id),
      "タスクを再開しました",
      "タスクを再開できませんでした",
    );
  }

  function editTask() {
    if (task.locked) {
      toast.info("ロック済みタスクです", {
        description: "編集するにはタスク詳細でロックを解除してください。",
      });
      return;
    }
    closeMenu();
    onEdit?.(task);
  }

  function requestDelete() {
    if (task.locked) {
      toast.info("ロック済みタスクです", {
        description: "削除するにはタスク詳細でロックを解除してください。",
      });
      return;
    }
    closeMenu();
    setDeleteDialogOpen(true);
  }

  return (
    <div className={cn("flex items-center justify-end gap-1.5", className)}>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${task.name}を今すぐ実行`}
        disabled={runNow.isPending || task.status === "deleted"}
        onClick={() =>
          withToast(
            runNow.mutateAsync(task.id),
            "実行をキューに追加しました",
            "実行をキューに追加できませんでした",
          )
        }
      >
        <Play className="size-4" aria-hidden="true" />
        今すぐ実行
      </Button>
      <DialogPrimitive.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${task.name}のその他の操作`}
            onClick={updateMenuPosition}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            ref={menuRef}
            role="menu"
            aria-label={`${task.name}のその他の操作`}
            className="fixed z-20 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ top: menuPosition.top, right: menuPosition.right }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              window.requestAnimationFrame(() => {
                menuRef.current
                  ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
                  ?.focus();
              });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              {task.name}のその他の操作
            </DialogPrimitive.Title>
          {canPause ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              role="menuitem"
              aria-label={`${task.name}を一時停止`}
              disabled={pause.isPending}
              onClick={pauseTask}
          >
              {task.locked ? (
                <LockKeyhole className="size-4" aria-hidden="true" />
              ) : (
                <Pause className="size-4" aria-hidden="true" />
              )}
              {task.locked ? "ロック済み" : "一時停止"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              role="menuitem"
              aria-label={`${task.name}を再開`}
              disabled={!canResume || resume.isPending}
              onClick={resumeTask}
            >
              {task.locked ? (
                <LockKeyhole className="size-4" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-4" aria-hidden="true" />
              )}
              {task.locked ? "ロック済み" : "再開"}
            </Button>
          )}
          {onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              role="menuitem"
              aria-label={`${task.name}を編集`}
              disabled={task.locked}
              onClick={editTask}
            >
              <Pencil className="size-4" aria-hidden="true" />
              編集
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-destructive hover:text-destructive"
            role="menuitem"
            aria-label={`${task.name}を削除`}
            disabled={task.locked}
            onClick={requestDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            削除
          </Button>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
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
              onClick={() =>
                withToast(
                  deleteTask.mutateAsync(task.id),
                  "タスクを削除しました",
                  "タスクを削除できませんでした",
                  () => onDeleted?.(task),
                )
              }
            >
              タスクを削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
