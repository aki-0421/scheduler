import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Loader2,
  PauseCircle,
  PlayCircle,
  SkipForward,
  TimerOff,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { RunStatus, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusTone = NonNullable<BadgeProps["variant"]>;
type StatusConfig = {
  label: string;
  variant: StatusTone;
  icon: LucideIcon;
  spin?: boolean;
};

const runStatusConfig: Record<RunStatus, StatusConfig> = {
  succeeded: { label: "成功", variant: "success", icon: CheckCircle2 },
  failed: { label: "失敗", variant: "destructive", icon: XCircle },
  running: { label: "実行中", variant: "info", icon: Loader2, spin: true },
  starting: { label: "開始中", variant: "info", icon: PlayCircle },
  queued: { label: "待機中", variant: "muted", icon: Clock3 },
  timed_out: { label: "タイムアウト", variant: "warning", icon: TimerOff },
  canceled: { label: "キャンセル済み", variant: "muted", icon: CircleSlash },
  skipped: { label: "スキップ", variant: "muted", icon: SkipForward },
  interrupted: { label: "中断", variant: "warning", icon: AlertTriangle },
};

const taskStatusConfig: Record<TaskStatus, StatusConfig> = {
  active: { label: "有効", variant: "success", icon: CheckCircle2 },
  paused: { label: "一時停止", variant: "muted", icon: PauseCircle },
  completed: { label: "完了", variant: "secondary", icon: CheckCircle2 },
  deleted: { label: "削除済み", variant: "destructive", icon: Trash2 },
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
  const Icon = config?.icon;

  return (
    <Badge
      variant={config?.variant ?? "muted"}
      className={props.className}
      title={props.status}
    >
      {Icon ? (
        <Icon
          className={cn("size-3.5 shrink-0", config.spin && "animate-spin")}
          aria-hidden="true"
        />
      ) : null}
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
