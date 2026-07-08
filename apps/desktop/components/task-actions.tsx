"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MoreHorizontal, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
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
  className?: string;
};

export function TaskRowActions({ task, onEdit, className }: TaskRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
            error instanceof Error ? error.message : "The scheduler command failed.",
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
      "Task paused",
      "Could not pause task",
    );
  }

  function resumeTask() {
    closeMenu();
    withToast(
      resume.mutateAsync(task.id),
      "Task resumed",
      "Could not resume task",
    );
  }

  function editTask() {
    closeMenu();
    onEdit?.(task);
  }

  function requestDelete() {
    closeMenu();
    setDeleteDialogOpen(true);
  }

  return (
    <div className={cn("flex items-center justify-end gap-1.5", className)}>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Run ${task.name} now`}
        disabled={runNow.isPending || task.status === "deleted"}
        onClick={() =>
          withToast(
            runNow.mutateAsync(task.id),
            "Run queued",
            "Could not queue run",
          )
        }
      >
        <Play className="size-4" aria-hidden="true" />
        Run now
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
            aria-label={`More actions for ${task.name}`}
            onClick={updateMenuPosition}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            ref={menuRef}
            role="menu"
            aria-label={`More actions for ${task.name}`}
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
              More actions for {task.name}
            </DialogPrimitive.Title>
          {canPause ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              role="menuitem"
              aria-label={`Pause ${task.name}`}
              disabled={pause.isPending}
              onClick={pauseTask}
            >
              <Pause className="size-4" aria-hidden="true" />
              Pause
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              role="menuitem"
              aria-label={`Resume ${task.name}`}
              disabled={!canResume || resume.isPending}
              onClick={resumeTask}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Resume
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            role="menuitem"
            aria-label={`Edit ${task.name}`}
            onClick={editTask}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-destructive hover:text-destructive"
            role="menuitem"
            aria-label={`Delete ${task.name}`}
            onClick={requestDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              {task.name} will be removed from active schedules. Existing run
              history will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                withToast(
                  deleteTask.mutateAsync(task.id),
                  "Task deleted",
                  "Could not delete task",
                )
              }
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
