import { z } from "zod";

import {
  defaultCodexModel,
  normalizeCodexModel,
  type CodexModel,
} from "@/lib/codex-options";

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | undefined => value ?? undefined);

const optionalNumber = z
  .union([z.number().int(), z.null(), z.undefined()])
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
export const triggerTypes = ["schedule", "manual", "cli", "catchup", "retry"] as const;
export const projectKinds = ["git", "folder"] as const;
export const logStreams = ["stdout", "stderr", "events"] as const;
export const runArtifactKinds = [
  "file",
  "diff",
  "patch",
  "log",
  "last-message",
  "worktree",
] as const;

export const taskKindSchema = z.enum(taskKinds);
export const taskStatusSchema = z.enum(taskStatuses);
export const runStatusSchema = z.enum(runStatuses);
export const targetModeSchema = z.enum(targetModes);
const optionalTargetMode = z
  .union([targetModeSchema, z.null(), z.undefined()])
  .transform(
    (value): z.infer<typeof targetModeSchema> | undefined => value ?? undefined,
  );
export const triggerTypeSchema = z.enum(triggerTypes);
export const projectKindSchema = z.enum(projectKinds);
export const logStreamSchema = z.enum(logStreams);
export const runArtifactKindSchema = z.enum(runArtifactKinds);

const auditJsonPayloadSchema = z.unknown().transform((value) => value ?? undefined);

export const taskAuditEventSchema = z
  .object({
    id: z.string(),
    taskId: optionalString,
    task_id: optionalString,
    actorType: optionalString,
    actor_type: optionalString,
    actorId: optionalString,
    actor_id: optionalString,
    action: z.string(),
    beforeJson: auditJsonPayloadSchema.optional(),
    before_json: auditJsonPayloadSchema.optional(),
    afterJson: auditJsonPayloadSchema.optional(),
    after_json: auditJsonPayloadSchema.optional(),
    reason: optionalString,
    createdAt: optionalString,
    created_at: optionalString,
  })
  .passthrough()
  .transform((event) => ({
    id: event.id,
    taskId: event.taskId ?? event.task_id,
    actorType: event.actorType ?? event.actor_type ?? "unknown",
    actorId: event.actorId ?? event.actor_id,
    action: event.action,
    beforeJson: event.beforeJson ?? event.before_json,
    afterJson: event.afterJson ?? event.after_json,
    reason: event.reason,
    createdAt: event.createdAt ?? event.created_at ?? "",
  }));

export const taskTargetDtoSchema = z.object({
  mode: targetModeSchema,
  projectId: optionalString,
  repoPath: optionalString,
  baseRef: optionalString,
});

export const taskCodexDtoSchema = z.object({
  codexPath: optionalString,
  model: optionalString,
  reasoningEffort: optionalString,
});

export const taskPromptDtoSchema = z.object({
  body: z.string(),
});

export const taskDtoSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: taskStatusSchema,
    locked: z.boolean().optional().default(false),
    kind: taskKindSchema,
    cronExpr: optionalString,
    runAt: optionalString,
    timezone: z.string(),
    nextRunAt: optionalString,
    target: taskTargetDtoSchema,
    codex: taskCodexDtoSchema,
    prompt: taskPromptDtoSchema,
    auditEvents: z.array(taskAuditEventSchema).optional(),
    audit_events: z.array(taskAuditEventSchema).optional(),
  })
  .transform(({ audit_events, ...task }) => {
    const auditEvents = task.auditEvents ?? audit_events;
    return auditEvents ? { ...task, auditEvents } : task;
  });

export const runArtifactDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: runArtifactKindSchema,
  path: z.string(),
  title: optionalString,
  mimeType: optionalString,
  sizeBytes: optionalNumber,
  createdAt: z.string(),
});

export const runDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  triggerType: triggerTypeSchema,
  scheduledFor: optionalString,
  attempt: optionalNumber,
  status: runStatusSchema,
  statusReason: optionalString,
  queuedAt: optionalString,
  startedAt: optionalString,
  endedAt: optionalString,
  durationMs: optionalNumber,
  targetMode: optionalTargetMode,
  workspacePath: optionalString,
  worktreePath: optionalString,
  branchName: optionalString,
  baseRef: optionalString,
  commitBefore: optionalString,
  commitAfter: optionalString,
  exitCode: optionalNumber,
  signal: optionalString,
  codexSessionId: optionalString,
  stdoutLogPath: optionalString,
  stderrLogPath: optionalString,
  eventsJsonlPath: optionalString,
  lastMessagePath: optionalString,
  stdoutTail: optionalString,
  stderrTail: optionalString,
  resultSummary: optionalString,
  findingsCount: defaultNumber,
  createdScheduleCount: defaultNumber,
  artifacts: z.array(runArtifactDtoSchema).optional(),
});

export const projectDtoSchema = z.object({
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

export const settingDtoSchema = z.object({
  key: z.string(),
  valueJson: z.string(),
  updatedAt: z.string(),
});

export const healthDtoSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  dbSchemaVersion: z.number().int(),
  schedulerEnabled: z.boolean(),
  runningCount: z.number().int(),
  queuedCount: z.number().int(),
});

export const daemonDiagnosticsSchema = z.object({
  version: z.string(),
  dbSchemaVersion: z.number().int(),
  dataDir: z.string(),
  socketPath: z.string(),
  dbSizeBytes: z.number().int(),
  logsSizeBytes: z.number().int(),
  taskCounts: z.record(z.number().int()),
  runCounts: z.record(z.number().int()),
  schedulerEnabled: z.boolean(),
  codexPath: z.object({
    value: optionalString,
    exists: z.boolean(),
  }),
  tickIntervalSec: z.number().int(),
  lastTickAt: optionalString,
});

export const daemonTickNowResultSchema = z.object({
  ok: z.boolean(),
  triggered: z.boolean(),
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
export const taskResultSchema = z
  .object({
    task: taskDtoSchema,
    auditEvents: z.array(taskAuditEventSchema).optional(),
    audit_events: z.array(taskAuditEventSchema).optional(),
  })
  .transform((result) => {
    const auditEvents =
      result.auditEvents ?? result.audit_events ?? result.task.auditEvents;
    return {
      task: auditEvents ? { ...result.task, auditEvents } : result.task,
    };
  });
export const taskDeleteResultSchema = z.object({ deleted: z.boolean() });
export const taskAuditListResultSchema = z.object({
  auditEvents: z.array(taskAuditEventSchema),
});
export const runListResultSchema = z.object({ runs: z.array(runDtoSchema) });
export const runResultSchema = z
  .object({
    run: runDtoSchema,
    artifacts: z.array(runArtifactDtoSchema).optional().default([]),
  })
  .transform(({ run, artifacts }) => ({ run: { ...run, artifacts }, artifacts }));
export const projectListResultSchema = z.object({
  projects: z.array(projectDtoSchema),
});
export const projectTrustResultSchema = z.object({ project: projectDtoSchema });
export const projectUntrustResultSchema = z
  .object({
    project: projectDtoSchema,
    affectedTaskCount: z.number().int().optional(),
    affected_task_count: z.number().int().optional(),
  })
  .transform((result) => ({
    project: result.project,
    affectedTaskCount: result.affectedTaskCount ?? result.affected_task_count ?? 0,
  }));
export const settingsGetResultSchema = z.object({
  settings: z.array(settingDtoSchema),
});
export const settingsSetResultSchema = z.object({ setting: settingDtoSchema });

export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type TargetMode = z.infer<typeof targetModeSchema>;
export type TriggerType = z.infer<typeof triggerTypeSchema>;
export type ProjectKind = z.infer<typeof projectKindSchema>;
export type LogStream = z.infer<typeof logStreamSchema>;
export type RunArtifactKind = z.infer<typeof runArtifactKindSchema>;
export type TaskAuditEvent = z.infer<typeof taskAuditEventSchema>;
export type TaskDto = z.infer<typeof taskDtoSchema>;
export type RunArtifactDto = z.infer<typeof runArtifactDtoSchema>;
export type RunDto = z.infer<typeof runDtoSchema>;
export type ProjectDto = z.infer<typeof projectDtoSchema>;
export type SettingDto = z.infer<typeof settingDtoSchema>;
export type HealthDto = z.infer<typeof healthDtoSchema>;
export type DaemonDiagnostics = z.infer<typeof daemonDiagnosticsSchema>;
export type DaemonTickNowResult = z.infer<typeof daemonTickNowResultSchema>;
export type RunTailLogResult = z.infer<typeof runTailLogResultSchema>;
export type ProjectUntrustResult = z.infer<typeof projectUntrustResultSchema>;

// TODO: Display Codex command lines here when RunDto exposes codexCommandJson.

export type SchedulerSettings = {
  "scheduler.enabled": boolean;
  "daemon.global_concurrency": number;
  "runner.codex_path": string;
  "runner.default_model": CodexModel;
  "notifications.enabled": boolean;
};

export const defaultSettings: SchedulerSettings = {
  "scheduler.enabled": true,
  "daemon.global_concurrency": 2,
  "runner.codex_path": "codex",
  "runner.default_model": defaultCodexModel,
  "notifications.enabled": true,
};

export function settingsToRecord(settings: SettingDto[]): SchedulerSettings {
  return settings.reduce<SchedulerSettings>((accumulator, setting) => {
    if (!(setting.key in defaultSettings)) {
      return accumulator;
    }

    try {
      const parsedValue = JSON.parse(setting.valueJson);
      return {
        ...accumulator,
        [setting.key]:
          setting.key === "runner.default_model"
            ? normalizeCodexModel(parsedValue)
            : parsedValue,
      };
    } catch {
      return accumulator;
    }
  }, defaultSettings);
}
