"use client";

import { Clipboard } from "lucide-react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { formatEnumLabel } from "@/lib/format";
import type { RunDto, TaskDto } from "@/lib/types";

type DisplayText = {
  label: string;
  detail?: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat("ja-JP", {
  numeric: "auto",
});

const countFormatter = new Intl.NumberFormat("ja-JP");

const dayLabels: Record<string, string> = {
  "0": "日曜日",
  "1": "月曜日",
  "2": "火曜日",
  "3": "水曜日",
  "4": "木曜日",
  "5": "金曜日",
  "6": "土曜日",
  "7": "日曜日",
};

const readableEnumLabels: Record<string, string> = {
  chat: "チャットワークスペース",
  "repo-local": "ローカルリポジトリ",
  "repo-worktree": "管理ワークツリー",
  manual: "手動",
  once: "一度だけ",
  cron: "スケジュール",
  schedule: "スケジュール",
  cli: "CLI",
  catchup: "追いつき実行",
  retry: "再試行",
  skip: "スキップ",
  latest_within_window: "期間内の最新のみ実行",
  run_all_capped: "上限付きで全て実行",
  queue: "キューに追加",
  cancel_previous: "前回の実行をキャンセル",
  keep: "保持",
  delete_on_success: "成功時に削除",
  delete_after_days: "保持期間後に削除",
  never: "確認しない",
  "on-request": "必要時に確認",
  untrusted: "信頼されていない変更で確認",
  "read-only": "読み取り専用",
  "workspace-write": "ワークスペース書き込み",
  "danger-full-access": "フルアクセス",
};

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function formatClock(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return timeFormatter.format(date);
}

function humanizeCron(expr: string) {
  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = expr.trim().split(/\s+/);
  const minute = Number(minutePart);
  const hour = Number(hourPart);

  if (
    [minutePart, hourPart, dayOfMonth, month, dayOfWeek].some((part) => part === undefined) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23 ||
    dayOfMonth !== "*" ||
    month !== "*"
  ) {
    return undefined;
  }

  const at = formatClock(hour, minute);
  if (dayOfWeek === "*") {
    return `毎日 ${at}`;
  }
  if (dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") {
    return `平日 ${at}`;
  }
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0") {
    return `週末 ${at}`;
  }
  if (dayLabels[dayOfWeek]) {
    return `毎週${dayLabels[dayOfWeek]} ${at}`;
  }

  return undefined;
}

export function formatCount(value: number) {
  return countFormatter.format(value);
}

export function formatAbsoluteDateTime(value?: string, empty = "未設定") {
  const date = parseDate(value);
  if (!value) {
    return empty;
  }
  if (!date) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function formatRelativeDateTime(value?: string, empty = "未設定") {
  const date = parseDate(value);
  if (!value) {
    return empty;
  }
  if (!date) {
    return value;
  }

  const seconds = Math.round((date.valueOf() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 45) {
    return "たった今";
  }

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const [unit, unitSeconds] =
    units.find(([, threshold]) => absoluteSeconds >= threshold) ?? units[units.length - 1];

  return relativeFormatter.format(Math.round(seconds / unitSeconds), unit);
}

export function formatRunDuration(run: RunDto) {
  const durationMs =
    run.durationMs ??
    (run.startedAt && run.endedAt
      ? new Date(run.endedAt).valueOf() - new Date(run.startedAt).valueOf()
      : undefined);

  if (!durationMs || durationMs < 0) {
    return "—";
  }

  if (durationMs < 1_000) {
    return "1秒未満";
  }
  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1_000)}秒`;
  }
  if (durationMs < 3_600_000) {
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1_000);
    return seconds ? `${minutes}分 ${seconds}秒` : `${minutes}分`;
  }

  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.round((durationMs % 3_600_000) / 60_000);
  return minutes ? `${hours}時間 ${minutes}分` : `${hours}時間`;
}

export function describeTaskSchedule(task: TaskDto): DisplayText {
  if (task.kind === "manual") {
    return { label: "手動", detail: "必要なときに実行" };
  }

  if (task.kind === "once") {
    return {
      label: "一度だけ実行",
      detail: formatAbsoluteDateTime(task.runAt),
    };
  }

  if (!task.cronExpr) {
    return { label: "スケジュール", detail: task.timezone };
  }

  const readableCron = humanizeCron(task.cronExpr);
  return {
    label: readableCron ?? "カスタムスケジュール",
    detail: `${task.timezone} · cron ${task.cronExpr}`,
  };
}

export function describeTaskTarget(task: TaskDto): DisplayText {
  const label = formatReadableEnum(task.target.mode);
  if (task.target.repoPath) {
    return { label, detail: task.target.repoPath };
  }
  if (task.target.projectId) {
    return { label, detail: task.target.projectId };
  }
  return { label, detail: "アプリ管理ワークスペース" };
}

export function formatReadableEnum(value?: string) {
  if (!value) {
    return "—";
  }

  return readableEnumLabels[value] ?? formatEnumLabel(value);
}

export function shortIdentifier(value?: string) {
  return value ? value.slice(0, 12) : "—";
}

type CopyButtonProps = {
  value?: string;
  label?: string;
  toastLabel?: string;
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
};

export function CopyButton({
  value,
  label = "コピー",
  toastLabel = label,
  className,
  size = "sm",
  variant = "outline",
}: CopyButtonProps) {
  const canCopy = Boolean(value);

  async function copy() {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${toastLabel}をコピーしました`);
    } catch (error) {
      toast.error("コピーできませんでした", {
        description:
          error instanceof Error ? error.message : "クリップボードへアクセスできませんでした。",
      });
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={!canCopy}
      onClick={() => void copy()}
    >
      <Clipboard data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  );
}
