import type {
  RunDto,
  RunStatus,
  TaskDto,
  TaskKind,
  TargetMode,
} from "@/lib/types";

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

const enumLabels: Record<string, string> = {
  manual: "手動",
  once: "一度だけ",
  cron: "Cron",
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

export function formatDateTime(value?: string) {
  if (!value) {
    return "未設定";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function formatDuration(run: RunDto) {
  const durationMs =
    run.durationMs ??
    (run.startedAt && run.endedAt
      ? new Date(run.endedAt).valueOf() - new Date(run.startedAt).valueOf()
      : undefined);

  if (!durationMs || durationMs < 0) {
    return "—";
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)}秒`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}分 ${seconds}秒`;
}

export function formatTaskSchedule(task: TaskDto) {
  if (task.kind === "manual") {
    return "手動";
  }

  if (task.kind === "once") {
    return `一度だけ: ${formatDateTime(task.runAt)}`;
  }

  return task.cronExpr ? `Cron ${task.cronExpr}` : "Cron";
}

export function formatTaskKind(kind: TaskKind) {
  return {
    manual: "手動",
    once: "一度だけ",
    cron: "Cron",
  }[kind];
}

export function formatTargetMode(mode: TargetMode) {
  return {
    chat: "チャット",
    "repo-local": "リポジトリ",
    "repo-worktree": "ワークツリー",
  }[mode];
}

export function formatEnumLabel(value?: string) {
  if (!value) {
    return "—";
  }

  return enumLabels[value] ?? value
    .replace(/:+/g, ": ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isRunActive(status: RunStatus) {
  return status === "queued" || status === "starting" || status === "running";
}

export function taskLastRun(task: TaskDto, runs: RunDto[]) {
  return runs
    .filter((run) => run.taskId === task.id)
    .sort((left, right) => {
      const leftDate = left.startedAt ?? left.scheduledFor ?? "";
      const rightDate = right.startedAt ?? right.scheduledFor ?? "";
      return rightDate.localeCompare(leftDate);
    })[0];
}
