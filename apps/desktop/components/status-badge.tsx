import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RunStatus, TaskStatus } from "@/lib/types";

type StatusTone = NonNullable<BadgeProps["variant"]>;

const runStatusConfig: Record<RunStatus, { label: string; variant: StatusTone }> = {
  succeeded: { label: "成功", variant: "success" },
  failed: { label: "失敗", variant: "destructive" },
  running: { label: "実行中", variant: "info" },
  starting: { label: "開始中", variant: "info" },
  queued: { label: "待機中", variant: "muted" },
  timed_out: { label: "タイムアウト", variant: "warning" },
  canceled: { label: "キャンセル", variant: "muted" },
  skipped: { label: "スキップ", variant: "muted" },
  interrupted: { label: "中断", variant: "warning" },
};

const taskStatusConfig: Record<TaskStatus, { label: string; variant: StatusTone }> = {
  active: { label: "有効", variant: "success" },
  paused: { label: "一時停止", variant: "muted" },
  completed: { label: "完了", variant: "secondary" },
  deleted: { label: "削除済み", variant: "destructive" },
};

type StatusBadgeProps =
  | {
      type: "run";
      status: RunStatus;
      className?: string;
    }
  | {
      type: "task";
      status: TaskStatus;
      className?: string;
    };

export function formatRunStatus(status: RunStatus) {
  return runStatusConfig[status].label;
}

export function formatTaskStatus(status: TaskStatus) {
  return taskStatusConfig[status].label;
}

export function StatusBadge(props: StatusBadgeProps) {
  const config =
    props.type === "run"
      ? runStatusConfig[props.status]
      : taskStatusConfig[props.status];

  return (
    <Badge variant={config.variant} className={props.className} title={props.status}>
      {config.label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <StatusBadge type="run" status={status} />;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <StatusBadge type="task" status={status} />;
}
