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
            error instanceof Error ? error.message : "Scheduler command failed.",
        }),
      );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Run ${task.name} now`}
        disabled={runNow.isPending || task.status === "deleted"}
        onClick={() =>
          withToast(runNow.mutateAsync(task.id), "Run queued", "Could not queue run")
        }
      >
        <Play className="size-4" aria-hidden="true" />
      </Button>
      {canPause ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Pause ${task.name}`}
          disabled={pause.isPending}
          onClick={() =>
            withToast(pause.mutateAsync(task.id), "Task paused", "Could not pause task")
          }
        >
          <Pause className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
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
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit ${task.name}`}
        onClick={() => onEdit?.(task)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Delete ${task.name}`}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {task.name} from active schedules. Existing runs remain in history.
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
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
