import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RunStatus, TaskStatus } from "@/lib/types";

type StatusTone = NonNullable<BadgeProps["variant"]>;

const runStatusConfig: Record<RunStatus, { label: string; variant: StatusTone }> = {
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  running: { label: "Running", variant: "info" },
  starting: { label: "Starting", variant: "info" },
  queued: { label: "Queued", variant: "muted" },
  timed_out: { label: "Timed out", variant: "warning" },
  canceled: { label: "Canceled", variant: "muted" },
  skipped: { label: "Skipped", variant: "muted" },
  interrupted: { label: "Interrupted", variant: "warning" },
};

const taskStatusConfig: Record<TaskStatus, { label: string; variant: StatusTone }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "muted" },
  completed: { label: "Completed", variant: "secondary" },
  deleted: { label: "Deleted", variant: "destructive" },
};

type StatusBadgeProps =
  | {
      type: "run";
      status: RunStatus | string;
      className?: string;
    }
  | {
      type: "task";
      status: TaskStatus | string;
      className?: string;
    };

export function formatRunStatus(status: RunStatus | string) {
  return runStatusConfig[status as RunStatus]?.label ?? status;
}

export function formatTaskStatus(status: TaskStatus | string) {
  return taskStatusConfig[status as TaskStatus]?.label ?? status;
}

export function StatusBadge(props: StatusBadgeProps) {
  const config =
    props.type === "run"
      ? runStatusConfig[props.status as RunStatus]
      : taskStatusConfig[props.status as TaskStatus];
  const label =
    config?.label ??
    (props.type === "run"
      ? formatRunStatus(props.status)
      : formatTaskStatus(props.status));

  return (
    <Badge variant={config?.variant ?? "muted"} className={props.className} title={props.status}>
      {label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <StatusBadge type="run" status={status} />;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <StatusBadge type="task" status={status} />;
}
