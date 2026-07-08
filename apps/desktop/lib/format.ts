import type {
  RunDto,
  RunStatus,
  TaskDto,
  TaskKind,
  TargetMode,
} from "@/lib/types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value?: string) {
  if (!value) {
    return "Not set";
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
    return `${Math.round(durationMs / 1000)} sec`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes} min ${seconds} sec`;
}

export function formatTaskSchedule(task: TaskDto) {
  if (task.kind === "manual") {
    return "Manual";
  }

  if (task.kind === "once") {
    return `Once: ${formatDateTime(task.runAt)}`;
  }

  return task.cronExpr ? `Cron ${task.cronExpr}` : "Cron";
}

export function formatTaskKind(kind: TaskKind) {
  return {
    manual: "Manual",
    once: "Once",
    cron: "Cron",
  }[kind];
}

export function formatTargetMode(mode: TargetMode) {
  return {
    chat: "Chat",
    "repo-local": "Repository",
    "repo-worktree": "Worktree",
  }[mode];
}

export function formatEnumLabel(value?: string) {
  if (!value) {
    return "—";
  }

  return value
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
