import { z } from "zod";

import {
  codexModelOptions,
  codexModelValues,
  defaultCodexModel,
  defaultReasoningEffort,
  normalizeCodexModel,
  normalizeReasoningEffort,
  reasoningEffortValues,
  type CodexModel,
  type ReasoningEffort,
} from "@/lib/codex-options";
import { getCronPreview } from "@/lib/cron";
import {
  getSystemTimezone,
  localDateTimeToUtcIso,
  utcIsoToLocalDateTime,
} from "@/lib/timezone";
import type { TaskDto } from "@/lib/types";

export const scheduleModes = ["manual", "once", "preset", "cron"] as const;
export const presetModes = ["hourly", "daily", "weekdays", "weekly"] as const;

export type ScheduleMode = (typeof scheduleModes)[number];
export type PresetMode = (typeof presetModes)[number];

export type TaskDraft = {
  id?: string;
  slug?: string;
  name: string;
  prompt: string;
  targetMode: "chat" | "repo-worktree";
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
  model: CodexModel;
  reasoningEffort: ReasoningEffort;
  forcePaused: boolean;
  locked: boolean;
};

export type StepErrors = Partial<
  Record<keyof TaskDraft | "cronPreview", string>
>;
type PresetSchedule = Pick<
  TaskDraft,
  "scheduleMode" | "presetMode" | "presetTime" | "weeklyDay"
>;

const defaultCronExpr = "0 9 * * 1-5";
const today = new Date();
const tomorrow = new Date(today.valueOf() + 24 * 60 * 60 * 1000);

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
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

function toTimeValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseCronNumber(value: string, min: number, max: number) {
  if (!/^\d{1,2}$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : undefined;
}

function inferPresetFromCron(expression: string): PresetSchedule | undefined {
  const [minuteValue, hourValue, dayOfMonth, month, dayOfWeek, ...extra] =
    expression.trim().replace(/\s+/g, " ").split(" ");

  if (
    extra.length > 0 ||
    !minuteValue ||
    !hourValue ||
    !dayOfMonth ||
    !month ||
    !dayOfWeek
  ) {
    return undefined;
  }

  const minute = parseCronNumber(minuteValue, 0, 59);
  if (minute === undefined || dayOfMonth !== "*" || month !== "*") {
    return undefined;
  }

  if (hourValue === "*" && minute === 0 && dayOfWeek === "*") {
    return {
      scheduleMode: "preset",
      presetMode: "hourly",
      presetTime: "09:00",
      weeklyDay: "1",
    };
  }

  const hour = parseCronNumber(hourValue, 0, 23);
  if (hour === undefined) {
    return undefined;
  }

  const presetTime = toTimeValue(hour, minute);

  if (dayOfWeek === "*") {
    return {
      scheduleMode: "preset",
      presetMode: "daily",
      presetTime,
      weeklyDay: "1",
    };
  }

  if (dayOfWeek === "1-5") {
    return {
      scheduleMode: "preset",
      presetMode: "weekdays",
      presetTime,
      weeklyDay: "1",
    };
  }

  const weeklyDay = parseCronNumber(dayOfWeek, 0, 6);
  if (weeklyDay === undefined) {
    return undefined;
  }

  return {
    scheduleMode: "preset",
    presetMode: "weekly",
    presetTime,
    weeklyDay: String(weeklyDay),
  };
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
  const presetSchedule = inferPresetFromCron(defaultCronExpr);

  return {
    name: "",
    prompt: "",
    targetMode: "chat",
    projectId: "",
    repoPath: "",
    baseRef: "main",
    scheduleMode: presetSchedule?.scheduleMode ?? "cron",
    timezone: getSystemTimezone(),
    onceDate: dateInputValue(tomorrow),
    onceTime: "09:00",
    presetMode: presetSchedule?.presetMode ?? "daily",
    presetTime: presetSchedule?.presetTime ?? "09:00",
    weeklyDay: presetSchedule?.weeklyDay ?? "1",
    cronExpr: defaultCronExpr,
    model: defaultCodexModel,
    reasoningEffort: defaultReasoningEffort,
    forcePaused: false,
    locked: false,
  };
}

export function taskToDraft(task: TaskDto): TaskDraft {
  const baseDraft = defaultTaskDraft();
  const timezone = getSystemTimezone();
  const once = splitTime(task.runAt, timezone);
  const cronExpr = task.cronExpr ?? defaultCronExpr;
  const presetSchedule =
    task.kind === "cron" ? inferPresetFromCron(cronExpr) : undefined;

  return {
    ...baseDraft,
    id: task.id,
    slug: task.slug,
    name: task.name,
    prompt: task.prompt.body,
    targetMode:
      task.target.mode === "chat" ? "chat" : ("repo-worktree" as const),
    projectId: task.target.projectId ?? "",
    repoPath: task.target.repoPath ?? "",
    baseRef: task.target.baseRef ?? "main",
    scheduleMode: presetSchedule?.scheduleMode ?? task.kind,
    timezone,
    onceDate: once.date,
    onceTime: once.time,
    presetMode: presetSchedule?.presetMode ?? baseDraft.presetMode,
    presetTime: presetSchedule?.presetTime ?? baseDraft.presetTime,
    weeklyDay: presetSchedule?.weeklyDay ?? baseDraft.weeklyDay,
    cronExpr,
    model: normalizeCodexModel(task.codex.model),
    reasoningEffort: normalizeReasoningEffort(
      task.codex.reasoningEffort,
      normalizeCodexModel(task.codex.model),
    ),
    forcePaused: task.status === "paused",
    locked: task.locked,
  };
}

const basicsSchema = z.object({
  name: z.string().trim().min(1, "タスク名は必須です。"),
  prompt: z.string().trim().min(1, "プロンプトは必須です。"),
});

const targetSchema = z
  .object({
    targetMode: z.enum(["chat", "repo-worktree"]),
    projectId: z.string(),
    repoPath: z.string(),
  })
  .superRefine((value, context) => {
    if (
      value.targetMode === "repo-worktree" &&
      (!value.projectId.trim() || !value.repoPath.trim())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoPath"],
        message: "プロジェクト実行には登録済みGitプロジェクトが必要です。",
      });
    }
  });

const scheduleSchema = z
  .object({
    scheduleMode: z.enum(scheduleModes),
    timezone: z.string().trim().min(1, "タイムゾーンは必須です。"),
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
              : "このタイムゾーンでは日付と時刻が無効です。",
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
    model: z.enum(codexModelValues, {
      errorMap: () => ({ message: "フロンティアモデルを選択してください。" }),
    }),
    reasoningEffort: z.enum(reasoningEffortValues, {
      errorMap: () => ({ message: "思考レベルを選択してください。" }),
    }),
  })
  .superRefine((value, context) => {
    const allowed = codexModelOptions.find(
      (option) => option.value === value.model,
    )?.efforts;
    if (!allowed?.includes(value.reasoningEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasoningEffort"],
        message: "選択したモデルに対応する思考レベルを選択してください。",
      });
    }
  });

export function validateTaskDraftStep(
  draft: TaskDraft,
  step: number,
): StepErrors {
  const schemas = [
    basicsSchema,
    targetSchema,
    scheduleSchema,
    codexSchema,
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
    kind === "cron" && cronExpr
      ? getCronPreview(cronExpr, draft.timezone)
      : undefined;
  const runAt =
    kind === "once"
      ? localDateTimeToUtcIso(draft.onceDate, draft.onceTime, draft.timezone)
      : undefined;

  return {
    id: draft.id ?? "",
    slug: draft.slug ?? "",
    name: draft.name.trim(),
    status: paused || draft.forcePaused ? "paused" : "active",
    locked: draft.locked,
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
      projectId:
        draft.targetMode === "chat" ? undefined : draft.projectId || undefined,
      repoPath: draft.targetMode === "chat" ? undefined : draft.repoPath.trim(),
      baseRef:
        draft.targetMode === "chat" ? undefined : draft.baseRef.trim() || undefined,
    },
    codex: {
      model: draft.model.trim(),
      reasoningEffort: draft.reasoningEffort.trim(),
    },
    prompt: { body: draft.prompt },
  };
}
