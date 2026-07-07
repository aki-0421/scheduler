import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { mockInvoke } from "@/lib/mock-ipc";
import {
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
  taskDeleteResultSchema,
  taskDtoSchema,
  taskListResultSchema,
  taskResultSchema,
  taskStatusSchema,
  type LogStream,
  type RunDto,
  type RunStatus,
  type RunTailLogResult,
  type SchedulerSettings,
  type SettingDto,
  type TaskDto,
  type TaskStatus,
} from "@/lib/types";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__)
  );
}

async function call<T>(
  command: string,
  params: Record<string, unknown> | undefined,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const raw = isTauriRuntime()
    ? await invoke<unknown>(command, params)
    : await mockInvoke(command, params);

  return schema.parse(raw);
}

export const ipcClient = {
  daemonHealth() {
    return call("daemon_health", undefined, healthDtoSchema);
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
