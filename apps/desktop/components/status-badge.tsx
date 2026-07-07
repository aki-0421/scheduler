import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RunStatus, TaskStatus } from "@/lib/types";

const runStatusVariant: Record<RunStatus, BadgeProps["variant"]> = {
  succeeded: "success",
  failed: "destructive",
  running: "info",
  starting: "info",
  queued: "muted",
  timed_out: "warning",
  canceled: "muted",
  skipped: "muted",
  interrupted: "warning",
};

const taskStatusVariant: Record<TaskStatus, BadgeProps["variant"]> = {
  active: "success",
  paused: "muted",
  completed: "secondary",
  deleted: "destructive",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={runStatusVariant[status]}>{status}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={taskStatusVariant[status]}>{status}</Badge>;
}
