"use client";

import { MoreHorizontal, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
      <details className="group relative">
        <summary
          aria-label={`More actions for ${task.name}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {canPause ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-label={`Pause ${task.name}`}
              disabled={pause.isPending}
              onClick={() =>
                withToast(
                  pause.mutateAsync(task.id),
                  "Task paused",
                  "Could not pause task",
                )
              }
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
              aria-label={`Resume ${task.name}`}
              disabled={!canResume || resume.isPending}
              onClick={() =>
                withToast(
                  resume.mutateAsync(task.id),
                  "Task resumed",
                  "Could not resume task",
                )
              }
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
            aria-label={`Edit ${task.name}`}
            onClick={() => onEdit?.(task)}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:text-destructive"
                aria-label={`Delete ${task.name}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </Button>
            </AlertDialogTrigger>
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
      </details>
    </div>
  );
}
