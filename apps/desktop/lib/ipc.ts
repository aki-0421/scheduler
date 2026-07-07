import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  daemonDiagnosticsSchema,
  daemonTickNowResultSchema,
  healthDtoSchema,
  logStreamSchema,
  projectListResultSchema,
  projectTrustResultSchema,
  runListResultSchema,
  runResultSchema,
  runStatusSchema,
  runTailLogResultSchema,
  settingsGetResultSchema,
  settingsSetResultSchema,
  taskAuditListResultSchema,
  taskDeleteResultSchema,
  taskDtoSchema,
  taskListResultSchema,
  taskResultSchema,
  taskStatusSchema,
  type DaemonDiagnostics,
  type DaemonTickNowResult,
  type LogStream,
  type RunDto,
  type RunStatus,
  type RunTailLogResult,
  type SchedulerSettings,
  type SettingDto,
  type TaskAuditEvent,
  type TaskDto,
  type TaskStatus,
} from "@/lib/types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__TAURI_INTERNALS__)
  );
}

async function fallbackInvoke(command: string, params?: unknown) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Tauri runtime is unavailable for command ${command}. Mock IPC is disabled in production.`,
    );
  }

  const { mockInvoke } = await import("@/lib/mock-ipc");
  return mockInvoke(command, params);
}

async function call<T>(
  command: string,
  params: Record<string, unknown> | undefined,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const raw = isTauriRuntime()
    ? await invoke<unknown>(command, params)
    : await fallbackInvoke(command, params);

  return schema.parse(raw);
}

const optionalPathSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | undefined => value ?? undefined);

const stringSchema = z.string();

const unitSchema = z
  .union([z.null(), z.undefined()])
  .transform((): void => undefined);

export const ipcClient = {
  daemonHealth() {
    return call("daemon_health", undefined, healthDtoSchema);
  },

  daemonDiagnostics(): Promise<DaemonDiagnostics> {
    return call("daemon_diagnostics", undefined, daemonDiagnosticsSchema);
  },

  daemonTickNow(): Promise<DaemonTickNowResult> {
    return call("daemon_tick_now", undefined, daemonTickNowResultSchema);
  },

  diagnosticsExport() {
    return call("diagnostics_export", undefined, optionalPathSchema);
  },

  exportRunLogs(runId: string) {
    return call("export_run_logs", { runId }, optionalPathSchema);
  },

  promptPickFile() {
    return call("prompt_pick_file", undefined, optionalPathSchema);
  },

  readPromptFile(path: string) {
    return call("read_prompt_file", { path }, stringSchema);
  },

  async taskList(filter?: { status?: TaskStatus }) {
    const status = filter?.status ? taskStatusSchema.parse(filter.status) : undefined;
    const result = await call(
      "task_list",
      status ? { status } : undefined,
      taskListResultSchema,
    );
    return result.tasks;
  },

  async taskGet(id: string) {
    const result = await call("task_get", { id }, taskResultSchema);
    return result.task;
  },

  async taskCreate(task: TaskDto) {
    const result = await call(
      "task_create",
      { task: taskDtoSchema.parse(task) },
      taskResultSchema,
    );
    return result.task;
  },

  async taskUpdate(task: TaskDto) {
    const result = await call(
      "task_update",
      { task: taskDtoSchema.parse(task) },
      taskResultSchema,
    );
    return result.task;
  },

  async taskDelete(id: string) {
    const result = await call("task_delete", { id }, taskDeleteResultSchema);
    return result.deleted;
  },

  async taskPause(id: string) {
    const result = await call("task_pause", { id }, taskResultSchema);
    return result.task;
  },

  async taskResume(id: string) {
    const result = await call("task_resume", { id }, taskResultSchema);
    return result.task;
  },

  async taskRunNow(id: string) {
    const result = await call("task_run_now", { id }, runResultSchema);
    return result.run;
  },

  async taskAuditList(taskId: string, limit = 50): Promise<TaskAuditEvent[]> {
    const result = await call(
      "task_audit_list",
      { taskId, limit },
      taskAuditListResultSchema,
    );
    return result.auditEvents;
  },

  async runList(filter?: { taskId?: string; status?: RunStatus }) {
    const status = filter?.status ? runStatusSchema.parse(filter.status) : undefined;
    const result = await call(
      "run_list",
      {
        ...(filter?.taskId ? { taskId: filter.taskId } : {}),
        ...(status ? { status } : {}),
      },
      runListResultSchema,
    );
    return result.runs;
  },

  async runGet(id: string) {
    const result = await call("run_get", { id }, runResultSchema);
    return result.run;
  },

  async runCancel(id: string) {
    const result = await call("run_cancel", { id }, runResultSchema);
    return result.run;
  },

  async runTailLog(params: {
    runId: string;
    stream: LogStream;
    cursor?: number;
    limit?: number;
  }): Promise<RunTailLogResult> {
    return call(
      "run_tail_log",
      {
        runId: params.runId,
        stream: logStreamSchema.parse(params.stream),
        cursor: params.cursor,
        limit: params.limit,
      },
      runTailLogResultSchema,
    );
  },

  async projectList() {
    const result = await call("project_list", undefined, projectListResultSchema);
    return result.projects;
  },

  async projectTrust(path: string) {
    const result = await call("project_trust", { path }, projectTrustResultSchema);
    return result.project;
  },

  projectPickFolder() {
    return call("project_pick_folder", undefined, optionalPathSchema);
  },

  openPath(path: string) {
    return call("open_path", { path }, unitSchema);
  },

  async settingsGet(key?: string): Promise<SettingDto[]> {
    const result = await call(
      "settings_get",
      key ? { key } : undefined,
      settingsGetResultSchema,
    );
    return result.settings;
  },

  async settingsSet<Key extends keyof SchedulerSettings>(
    key: Key,
    value: SchedulerSettings[Key],
  ): Promise<SettingDto> {
    const result = await call(
      "settings_set",
      { key, value },
      settingsSetResultSchema,
    );
    return result.setting;
  },
};

export type IpcClient = typeof ipcClient;
export type { RunDto };
