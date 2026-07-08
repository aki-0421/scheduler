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

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

const countFormatter = new Intl.NumberFormat("en-US");

const dayLabels: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

const readableEnumLabels: Record<string, string> = {
  chat: "Chat workspace",
  "repo-local": "Local repository",
  "repo-worktree": "Managed worktree",
  manual: "Manual",
  once: "One-time",
  cron: "Scheduled",
  schedule: "Scheduled",
  cli: "CLI",
  catchup: "Catch-up",
  retry: "Retry",
  skip: "Skip",
  latest_within_window: "Run latest within window",
  run_all_capped: "Run all, capped",
  queue: "Queue",
  cancel_previous: "Cancel previous",
  keep: "Keep",
  delete_on_success: "Delete on success",
  delete_after_days: "Delete after retention",
  never: "Never ask",
  "on-request": "Ask when needed",
  untrusted: "Ask for untrusted changes",
  "read-only": "Read-only",
  "workspace-write": "Workspace write",
  "danger-full-access": "Full access",
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
    return `Daily at ${at}`;
  }
  if (dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") {
    return `Weekdays at ${at}`;
  }
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0") {
    return `Weekends at ${at}`;
  }
  if (dayLabels[dayOfWeek]) {
    return `Every ${dayLabels[dayOfWeek]} at ${at}`;
  }

  return undefined;
}

export function formatCount(value: number) {
  return countFormatter.format(value);
}

export function formatAbsoluteDateTime(value?: string, empty = "Not set") {
  const date = parseDate(value);
  if (!value) {
    return empty;
  }
  if (!date) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function formatRelativeDateTime(value?: string, empty = "Not set") {
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
    return "just now";
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
    return "<1 sec";
  }
  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1_000)} sec`;
  }
  if (durationMs < 3_600_000) {
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1_000);
    return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.round((durationMs % 3_600_000) / 60_000);
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export function describeTaskSchedule(task: TaskDto): DisplayText {
  if (task.kind === "manual") {
    return { label: "Manual", detail: "Run on demand" };
  }

  if (task.kind === "once") {
    return {
      label: "One-time run",
      detail: formatAbsoluteDateTime(task.runAt),
    };
  }

  if (!task.cronExpr) {
    return { label: "Scheduled", detail: task.timezone };
  }

  const readableCron = humanizeCron(task.cronExpr);
  return {
    label: readableCron ?? "Custom schedule",
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
  return { label, detail: "App-managed workspace" };
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
  label = "Copy",
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
      toast.success(`${toastLabel} copied`);
    } catch (error) {
      toast.error("Could not copy", {
        description:
          error instanceof Error ? error.message : "Clipboard access failed.",
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
      <Clipboard className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
