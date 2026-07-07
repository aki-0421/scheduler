import { z } from "zod";

import { getCronPreview } from "@/lib/cron";
import { localDateTimeToUtcIso, utcIsoToLocalDateTime } from "@/lib/timezone";
import {
  approvalPolicySchema,
  cleanupPolicySchema,
  missedPolicySchema,
  overlapPolicySchema,
  sandboxModeSchema,
  targetModeSchema,
  type TaskDto,
} from "@/lib/types";

export const scheduleModes = ["manual", "once", "preset", "cron"] as const;
export const presetModes = ["hourly", "daily", "weekdays", "weekly"] as const;

export type ScheduleMode = (typeof scheduleModes)[number];
export type PresetMode = (typeof presetModes)[number];

export type TaskDraft = {
  id?: string;
  slug?: string;
  name: string;
  description: string;
  prompt: string;
  injectSchedulerInstructions: boolean;
  targetMode: "chat" | "repo-local" | "repo-worktree";
  projectId: string;
  repoPath: string;
  baseRef: string;
  scheduleMode: ScheduleMode;
  timezone: string;
  onceDate: string;
  onceTime: string;
  presetMode: PresetMode;
  presetTime: string;
  weeklyDay: string;
  cronExpr: string;
  model: string;
  reasoningEffort: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "untrusted";
  maxRuntimeSec: number;
  maxRetries: number;
  missedPolicy: "skip" | "latest_within_window" | "run_all_capped";
  overlapPolicy: "skip" | "queue" | "cancel_previous";
  cleanupPolicy: "keep" | "delete_on_success" | "delete_after_days";
  allowScheduleCli: boolean;
  maxCreatedSchedulesPerRun: number;
  capabilities: string[];
  forcePaused: boolean;
  dangerConfirmed: boolean;
};

export type StepErrors = Partial<Record<keyof TaskDraft | "cronPreview", string>>;

const today = new Date();
const tomorrow = new Date(today.valueOf() + 24 * 60 * 60 * 1000);

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function splitTime(value: string | undefined, timeZone: string) {
  if (!value) {
    return { date: dateInputValue(tomorrow), time: "09:00" };
  }

  try {
    return utcIsoToLocalDateTime(value, timeZone);
  } catch {
    return { date: dateInputValue(tomorrow), time: "09:00" };
  }
}

function presetExpression(draft: TaskDraft) {
  const [hour = "9", minute = "0"] = draft.presetTime.split(":");
  const normalizedHour = String(Number(hour));
  const normalizedMinute = String(Number(minute));

  if (draft.presetMode === "hourly") {
    return "0 * * * *";
  }

  if (draft.presetMode === "daily") {
    return `${normalizedMinute} ${normalizedHour} * * *`;
  }

  if (draft.presetMode === "weekdays") {
    return `${normalizedMinute} ${normalizedHour} * * 1-5`;
  }

  return `${normalizedMinute} ${normalizedHour} * * ${draft.weeklyDay}`;
}

export function getDraftCronExpression(draft: TaskDraft) {
  if (draft.scheduleMode === "preset") {
    return presetExpression(draft);
  }

  if (draft.scheduleMode === "cron") {
    return draft.cronExpr.trim().replace(/\s+/g, " ");
  }

  return undefined;
}

export function defaultTaskDraft(): TaskDraft {
  return {
    name: "",
    description: "",
    prompt: "",
    injectSchedulerInstructions: true,
    targetMode: "chat",
    projectId: "",
    repoPath: "",
    baseRef: "main",
    scheduleMode: "cron",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
    onceDate: dateInputValue(tomorrow),
    onceTime: "09:00",
    presetMode: "daily",
    presetTime: "09:00",
    weeklyDay: "1",
    cronExpr: "0 9 * * 1-5",
    model: "gpt-5-codex",
    reasoningEffort: "default",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    maxRuntimeSec: 7200,
    maxRetries: 0,
    missedPolicy: "latest_within_window",
    overlapPolicy: "skip",
    cleanupPolicy: "keep",
    allowScheduleCli: true,
    maxCreatedSchedulesPerRun: 5,
    capabilities: ["schedule:create", "schedule:update-current", "schedule:list"],
    forcePaused: false,
    dangerConfirmed: false,
  };
}

export function taskToDraft(task: TaskDto): TaskDraft {
  const once = splitTime(task.runAt, task.timezone);
  return {
    ...defaultTaskDraft(),
    id: task.id,
    slug: task.slug,
    name: task.name,
    description: task.description ?? "",
    prompt: task.prompt.body,
    injectSchedulerInstructions: task.prompt.injectSchedulerInstructions,
    targetMode: task.target.mode,
    projectId: task.target.projectId ?? "",
    repoPath: task.target.repoPath ?? "",
    baseRef: task.target.baseRef ?? "main",
    scheduleMode: task.kind,
    timezone: task.timezone,
    onceDate: once.date,
    onceTime: once.time,
    cronExpr: task.cronExpr ?? "0 9 * * 1-5",
    model: task.codex.model ?? "gpt-5-codex",
    reasoningEffort: task.codex.reasoningEffort ?? "default",
    sandboxMode: task.codex.sandboxMode,
    approvalPolicy: task.codex.approvalPolicy,
    maxRuntimeSec: task.policies.maxRuntimeSec,
    maxRetries: task.policies.maxRetries ?? 0,
    missedPolicy: task.policies.missedPolicy,
    overlapPolicy: task.policies.overlapPolicy,
    cleanupPolicy: task.policies.cleanupPolicy ?? "keep",
    allowScheduleCli: task.policies.allowScheduleCli,
    maxCreatedSchedulesPerRun: task.policies.maxCreatedSchedulesPerRun ?? 5,
    capabilities: task.policies.scheduleCliCapabilities ?? [],
    forcePaused: task.status === "paused",
  };
}

const basicsSchema = z.object({
  name: z.string().trim().min(1, "名前は必須です。"),
  prompt: z.string().trim().min(1, "prompt は必須です。"),
});

const targetSchema = z
  .object({
    targetMode: targetModeSchema,
    repoPath: z.string(),
  })
  .superRefine((value, context) => {
    if (value.targetMode !== "chat" && !value.repoPath.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoPath"],
        message: "リポジトリパスは必須です。",
      });
    }
  });

const scheduleSchema = z
  .object({
    scheduleMode: z.enum(scheduleModes),
    timezone: z.string().trim().min(1, "timezone は必須です。"),
    onceDate: z.string(),
    onceTime: z.string(),
    cronExpr: z.string(),
  })
  .superRefine((value, context) => {
    if (value.scheduleMode === "once" && (!value.onceDate || !value.onceTime)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["onceDate"],
        message: "日付と時刻は必須です。",
      });
    }

    if (value.scheduleMode === "once" && value.onceDate && value.onceTime) {
      try {
        localDateTimeToUtcIso(value.onceDate, value.onceTime, value.timezone);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["onceDate"],
          message:
            error instanceof Error
              ? error.message
              : "timezone に対して日時が不正です。",
        });
      }
    }

    if (value.scheduleMode === "cron") {
      const preview = getCronPreview(value.cronExpr, value.timezone);
      if (!preview.ok) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cronPreview"],
          message: preview.error,
        });
      }
    }
  });

const codexSchema = z
  .object({
    model: z.string().trim().min(1, "model は必須です。"),
    reasoningEffort: z.string().trim().min(1, "reasoning effort は必須です。"),
    sandboxMode: sandboxModeSchema,
    approvalPolicy: approvalPolicySchema,
    maxRuntimeSec: z.coerce.number().int().min(60, "60 秒以上を指定してください。"),
    maxRetries: z.coerce.number().int().min(0, "retry 回数に負の値は指定できません。"),
    missedPolicy: missedPolicySchema,
    overlapPolicy: overlapPolicySchema,
    cleanupPolicy: cleanupPolicySchema,
    dangerConfirmed: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.sandboxMode === "danger-full-access" && !value.dangerConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dangerConfirmed"],
        message: "続行する前に danger-full-access を確認してください。",
      });
    }
  });

const permissionsSchema = z.object({
  maxCreatedSchedulesPerRun: z.coerce
    .number()
    .int()
    .min(1, "1 件以上のスケジュールを指定してください。")
    .max(100, "スケジュールは 100 件以下にしてください。"),
});

export function validateTaskDraftStep(draft: TaskDraft, step: number): StepErrors {
  const schemas = [
    basicsSchema,
    targetSchema,
    scheduleSchema,
    codexSchema,
    permissionsSchema,
  ];
  const schema = schemas[step];
  if (!schema) {
    return {};
  }

  const result = schema.safeParse(draft);
  if (result.success) {
    return {};
  }

  return result.error.issues.reduce<StepErrors>((errors, issue) => {
    const key = issue.path[0] as keyof StepErrors;
    errors[key] = issue.message;
    return errors;
  }, {});
}

export function buildTaskDto(draft: TaskDraft, paused = false): TaskDto {
  const kind =
    draft.scheduleMode === "preset"
      ? "cron"
      : draft.scheduleMode === "manual"
        ? "manual"
        : draft.scheduleMode;
  const cronExpr = getDraftCronExpression(draft);
  const preview =
    kind === "cron" && cronExpr ? getCronPreview(cronExpr, draft.timezone) : undefined;
  const runAt =
    kind === "once"
      ? localDateTimeToUtcIso(draft.onceDate, draft.onceTime, draft.timezone)
      : undefined;

  return {
    id: draft.id ?? "",
    slug: draft.slug ?? slugify(draft.name),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    status: paused || draft.forcePaused ? "paused" : "active",
    kind,
    cronExpr,
    runAt,
    timezone: draft.timezone,
    nextRunAt:
      kind === "cron" && preview?.ok
        ? preview.dates[0]
        : kind === "once"
          ? runAt
          : undefined,
    target: {
      mode: draft.targetMode,
      projectId: draft.projectId || undefined,
      repoPath: draft.targetMode === "chat" ? undefined : draft.repoPath.trim(),
      baseRef: draft.baseRef.trim() || undefined,
    },
    codex: {
      model: draft.model.trim(),
      reasoningEffort: draft.reasoningEffort.trim(),
      sandboxMode: draft.sandboxMode,
      approvalPolicy: draft.approvalPolicy,
    },
    prompt: {
      body: draft.prompt,
      injectSchedulerInstructions: draft.injectSchedulerInstructions,
    },
    policies: {
      allowScheduleCli: draft.allowScheduleCli,
      missedPolicy: draft.missedPolicy,
      overlapPolicy: draft.overlapPolicy,
      maxRuntimeSec: Number(draft.maxRuntimeSec),
      maxCreatedSchedulesPerRun: Number(draft.maxCreatedSchedulesPerRun),
      scheduleCliCapabilities: draft.capabilities,
      missedWindowDays: 7,
      maxRetries: Number(draft.maxRetries),
      retryBackoffSec: 300,
      cleanupPolicy: draft.cleanupPolicy,
    },
  };
}
