import { z } from "zod";

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | undefined => value ?? undefined);

const optionalNumber = z
  .union([z.number(), z.null(), z.undefined()])
  .transform((value): number | undefined => value ?? undefined);

const defaultNumber = z
  .union([z.number().int(), z.null(), z.undefined()])
  .transform((value): number => value ?? 0);

export const taskKinds = ["manual", "once", "cron"] as const;
export const taskStatuses = ["active", "paused", "completed", "deleted"] as const;
export const runStatuses = [
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "skipped",
  "interrupted",
  "timed_out",
] as const;
export const targetModes = ["chat", "repo-local", "repo-worktree"] as const;
export const sandboxModes = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;
export const approvalPolicies = ["never", "on-request", "untrusted"] as const;
export const missedPolicies = [
  "skip",
  "latest_within_window",
  "run_all_capped",
] as const;
export const overlapPolicies = ["skip", "queue", "cancel_previous"] as const;
export const cleanupPolicies = [
  "keep",
  "delete_on_success",
  "delete_after_days",
] as const;
export const triggerTypes = ["schedule", "manual", "cli", "catchup", "retry"] as const;
export const projectKinds = ["git", "folder"] as const;
export const logStreams = ["stdout", "stderr"] as const;

export const taskKindSchema = z.enum(taskKinds);
export const taskStatusSchema = z.enum(taskStatuses);
export const runStatusSchema = z.enum(runStatuses);
export const targetModeSchema = z.enum(targetModes);
export const sandboxModeSchema = z.enum(sandboxModes);
export const approvalPolicySchema = z.enum(approvalPolicies);
export const missedPolicySchema = z.enum(missedPolicies);
export const overlapPolicySchema = z.enum(overlapPolicies);
export const cleanupPolicySchema = z.enum(cleanupPolicies);
export const triggerTypeSchema = z.enum(triggerTypes);
export const projectKindSchema = z.enum(projectKinds);
export const logStreamSchema = z.enum(logStreams);

export const taskTargetDtoSchema = z.object({
  mode: targetModeSchema,
  projectId: optionalString,
  repoPath: optionalString,
  baseRef: optionalString,
});

export const taskCodexDtoSchema = z.object({
  model: optionalString,
  reasoningEffort: optionalString,
  sandboxMode: sandboxModeSchema,
  approvalPolicy: approvalPolicySchema,
});

export const taskPromptDtoSchema = z.object({
  body: z.string(),
  injectSchedulerInstructions: z.boolean(),
});

export const taskPoliciesDtoSchema = z.object({
  allowScheduleCli: z.boolean(),
  missedPolicy: missedPolicySchema,
  overlapPolicy: overlapPolicySchema,
  maxRuntimeSec: z.number().int().positive(),
  scheduleCliCapabilities: z.array(z.string()).optional(),
  missedWindowDays: optionalNumber,
  maxRetries: optionalNumber,
  retryBackoffSec: optionalNumber,
  cleanupPolicy: cleanupPolicySchema.optional(),
  cleanupAfterDays: optionalNumber,
});

export const taskDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: optionalString,
  status: taskStatusSchema,
  kind: taskKindSchema,
  cronExpr: optionalString,
  runAt: optionalString,
  timezone: z.string(),
  nextRunAt: optionalString,
  target: taskTargetDtoSchema,
  codex: taskCodexDtoSchema,
  prompt: taskPromptDtoSchema,
  policies: taskPoliciesDtoSchema,
});

export const runDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  triggerType: triggerTypeSchema,
  scheduledFor: optionalString,
  status: runStatusSchema,
  statusReason: optionalString,
  queuedAt: optionalString,
  startedAt: optionalString,
  endedAt: optionalString,
  durationMs: optionalNumber,
  targetMode: targetModeSchema.optional(),
  workspacePath: optionalString,
  worktreePath: optionalString,
  branchName: optionalString,
  baseRef: optionalString,
  exitCode: optionalNumber,
  signal: optionalString,
  stdoutTail: optionalString,
  stderrTail: optionalString,
  resultSummary: optionalString,
  findingsCount: defaultNumber,
  createdScheduleCount: defaultNumber,
});

function normalizeProject(value: unknown) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const project = value as Record<string, unknown>;
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    kind: project.kind,
    gitRoot: project.gitRoot ?? project.git_root,
    gitRemoteUrl: project.gitRemoteUrl ?? project.git_remote_url,
    defaultBranch: project.defaultBranch ?? project.default_branch,
    trustedAt: project.trustedAt ?? project.trusted_at,
    createdAt: project.createdAt ?? project.created_at,
    updatedAt: project.updatedAt ?? project.updated_at,
  };
}

const projectDtoObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: projectKindSchema,
  gitRoot: optionalString,
  gitRemoteUrl: optionalString,
  defaultBranch: optionalString,
  trustedAt: optionalString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectDtoSchema = z.preprocess(
  normalizeProject,
  projectDtoObjectSchema,
) as z.ZodType<z.infer<typeof projectDtoObjectSchema>, z.ZodTypeDef, unknown>;

function normalizeSetting(value: unknown) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const setting = value as Record<string, unknown>;
  return {
    key: setting.key,
    valueJson: setting.valueJson ?? setting.value_json,
    updatedAt: setting.updatedAt ?? setting.updated_at,
  };
}

const settingDtoObjectSchema = z.object({
  key: z.string(),
  valueJson: z.string(),
  updatedAt: z.string(),
});

export const settingDtoSchema = z.preprocess(
  normalizeSetting,
  settingDtoObjectSchema,
) as z.ZodType<z.infer<typeof settingDtoObjectSchema>, z.ZodTypeDef, unknown>;

export const healthDtoSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  dbSchemaVersion: z.number().int(),
  schedulerEnabled: z.boolean(),
  runningCount: z.number().int(),
  queuedCount: z.number().int(),
});

export const runTailLogResultSchema = z.object({
  runId: z.string(),
  stream: logStreamSchema,
  cursor: z.number().int(),
  nextCursor: z.number().int(),
  eof: z.boolean(),
  data: z.string(),
});

export const taskListResultSchema = z.object({ tasks: z.array(taskDtoSchema) });
export const taskResultSchema = z.object({ task: taskDtoSchema });
export const taskDeleteResultSchema = z.object({ deleted: z.boolean() });
export const runListResultSchema = z.object({ runs: z.array(runDtoSchema) });
export const runResultSchema = z.object({ run: runDtoSchema });
export const projectListResultSchema = z.object({
  projects: z.array(projectDtoSchema),
});
export const projectTrustResultSchema = z.object({ project: projectDtoSchema });
export const settingsGetResultSchema = z.object({
  settings: z.array(settingDtoSchema),
});
export const settingsSetResultSchema = z.object({ setting: settingDtoSchema });

export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type TargetMode = z.infer<typeof targetModeSchema>;
export type SandboxMode = z.infer<typeof sandboxModeSchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type MissedPolicy = z.infer<typeof missedPolicySchema>;
export type OverlapPolicy = z.infer<typeof overlapPolicySchema>;
export type CleanupPolicy = z.infer<typeof cleanupPolicySchema>;
export type TriggerType = z.infer<typeof triggerTypeSchema>;
export type ProjectKind = z.infer<typeof projectKindSchema>;
export type LogStream = z.infer<typeof logStreamSchema>;
export type TaskDto = z.infer<typeof taskDtoSchema>;
export type RunDto = z.infer<typeof runDtoSchema>;
export type ProjectDto = z.infer<typeof projectDtoSchema>;
export type SettingDto = z.infer<typeof settingDtoSchema>;
export type HealthDto = z.infer<typeof healthDtoSchema>;
export type RunTailLogResult = z.infer<typeof runTailLogResultSchema>;

export type SchedulerSettings = {
  "scheduler.enabled": boolean;
  "daemon.global_concurrency": number;
  "runner.codex_path": string;
  "runner.default_model": string;
  "runner.default_sandbox_mode": SandboxMode;
  "runner.default_approval_policy": ApprovalPolicy;
  "notifications.enabled": boolean;
  "worktree.default_cleanup_policy": CleanupPolicy;
};

export const defaultSettings: SchedulerSettings = {
  "scheduler.enabled": true,
  "daemon.global_concurrency": 2,
  "runner.codex_path": "codex",
  "runner.default_model": "gpt-5-codex",
  "runner.default_sandbox_mode": "workspace-write",
  "runner.default_approval_policy": "never",
  "notifications.enabled": true,
  "worktree.default_cleanup_policy": "keep",
};

export function settingsToRecord(settings: SettingDto[]): SchedulerSettings {
  return settings.reduce<SchedulerSettings>((accumulator, setting) => {
    if (!(setting.key in defaultSettings)) {
      return accumulator;
    }

    try {
      return {
        ...accumulator,
        [setting.key]: JSON.parse(setting.valueJson),
      };
    } catch {
      return accumulator;
    }
  }, defaultSettings);
}
