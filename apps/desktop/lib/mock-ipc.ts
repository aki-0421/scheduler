import type {
  HealthDto,
  LogStream,
  ProjectDto,
  RunDto,
  RunStatus,
  SchedulerSettings,
  SettingDto,
  TaskDto,
  TaskStatus,
} from "@/lib/types";
import { defaultSettings } from "@/lib/types";

type JsonObject = Record<string, unknown>;

const createdAt = new Date().toISOString();

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const settings = new Map<keyof SchedulerSettings, SettingDto>(
  Object.entries(defaultSettings).map(([key, value]) => [
    key as keyof SchedulerSettings,
    {
      key,
      valueJson: JSON.stringify(value),
      updatedAt: createdAt,
    },
  ]),
);

let projects: ProjectDto[] = [
  {
    id: "proj_demo",
    name: "davis-v2",
    path: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
    kind: "git",
    gitRoot: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
    gitRemoteUrl: undefined,
    defaultBranch: "main",
    trustedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  },
];

let tasks: TaskDto[] = [
  {
    id: "task_daily_review",
    slug: "daily-review",
    name: "Daily repository review",
    description: "Summarize risk in the active scheduler workspace.",
    status: "active",
    kind: "cron",
    cronExpr: "0 9 * * 1-5",
    runAt: undefined,
    timezone: "Asia/Tokyo",
    nextRunAt: minutesFromNow(120),
    target: {
      mode: "repo-worktree",
      projectId: "proj_demo",
      repoPath: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
      baseRef: "main",
    },
    codex: {
      model: "gpt-5-codex",
      reasoningEffort: "default",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    },
    prompt: {
      body: "Review the latest scheduler changes and summarize regressions.",
      injectSchedulerInstructions: true,
    },
    policies: {
      allowScheduleCli: true,
      missedPolicy: "latest_within_window",
      overlapPolicy: "skip",
      maxRuntimeSec: 7200,
      scheduleCliCapabilities: [
        "schedule:create",
        "schedule:update-current",
        "schedule:list",
      ],
      missedWindowDays: 7,
      maxRetries: 1,
      retryBackoffSec: 300,
      cleanupPolicy: "keep",
    },
  },
  {
    id: "task_dependency_scan",
    slug: "dependency-scan",
    name: "Dependency scan",
    description: "Check dependency updates and create follow-up schedules.",
    status: "paused",
    kind: "cron",
    cronExpr: "30 8 * * 1",
    runAt: undefined,
    timezone: "Asia/Tokyo",
    nextRunAt: undefined,
    target: {
      mode: "repo-local",
      projectId: "proj_demo",
      repoPath: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
      baseRef: "main",
    },
    codex: {
      model: "gpt-5-codex",
      reasoningEffort: "low",
      sandboxMode: "read-only",
      approvalPolicy: "never",
    },
    prompt: {
      body: "Find outdated dependencies and propose a safe update plan.",
      injectSchedulerInstructions: true,
    },
    policies: {
      allowScheduleCli: true,
      missedPolicy: "skip",
      overlapPolicy: "queue",
      maxRuntimeSec: 5400,
      scheduleCliCapabilities: ["schedule:create", "schedule:update-current"],
      missedWindowDays: 3,
      maxRetries: 0,
      retryBackoffSec: 300,
      cleanupPolicy: "delete_on_success",
    },
  },
  {
    id: "task_release_notes",
    slug: "release-notes",
    name: "Draft release notes",
    description: "One-time run for the next local release.",
    status: "active",
    kind: "once",
    cronExpr: undefined,
    runAt: minutesFromNow(360),
    timezone: "Asia/Tokyo",
    nextRunAt: minutesFromNow(360),
    target: { mode: "chat", projectId: undefined, repoPath: undefined },
    codex: {
      model: "gpt-5-codex",
      reasoningEffort: "medium",
      sandboxMode: "read-only",
      approvalPolicy: "never",
    },
    prompt: {
      body: "Draft release notes from the latest merged work.",
      injectSchedulerInstructions: false,
    },
    policies: {
      allowScheduleCli: false,
      missedPolicy: "latest_within_window",
      overlapPolicy: "skip",
      maxRuntimeSec: 3600,
      scheduleCliCapabilities: [],
      missedWindowDays: 7,
      maxRetries: 0,
      retryBackoffSec: 300,
      cleanupPolicy: "keep",
    },
  },
];

let runs: RunDto[] = [
  {
    id: "run_success",
    taskId: "task_daily_review",
    triggerType: "schedule",
    scheduledFor: minutesAgo(24 * 60),
    attempt: 1,
    status: "succeeded",
    statusReason: undefined,
    queuedAt: minutesAgo(24 * 60),
    startedAt: minutesAgo(24 * 60 - 1),
    endedAt: minutesAgo(24 * 60 - 5),
    durationMs: 240_000,
    targetMode: "repo-worktree",
    workspacePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/run_success",
    worktreePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/run_success",
    branchName: "codex-scheduler/daily-review/run_success",
    baseRef: "main",
    commitBefore: "abc123",
    commitAfter: "def456",
    exitCode: 0,
    signal: undefined,
    codexSessionId: "sess_success",
    stdoutLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/stdout.log",
    stderrLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/stderr.log",
    eventsJsonlPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/events.jsonl",
    lastMessagePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/last-message.md",
    stdoutTail: "Final: No critical issues found\n",
    stderrTail: "",
    resultSummary: "No critical issues found. Two follow-up notes were recorded.",
    findingsCount: 2,
    createdScheduleCount: 1,
  },
  {
    id: "run_failed",
    taskId: "task_dependency_scan",
    triggerType: "manual",
    scheduledFor: minutesAgo(90),
    attempt: 1,
    status: "failed",
    statusReason: "Codex exited with code 1 after package metadata lookup failed.",
    queuedAt: minutesAgo(90),
    startedAt: minutesAgo(89),
    endedAt: minutesAgo(84),
    durationMs: 300_000,
    targetMode: "repo-local",
    workspacePath: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
    worktreePath: undefined,
    branchName: undefined,
    baseRef: "main",
    commitBefore: "feed01",
    commitAfter: undefined,
    exitCode: 1,
    signal: undefined,
    codexSessionId: "sess_failed",
    stdoutLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_failed/stdout.log",
    stderrLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_failed/stderr.log",
    eventsJsonlPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_failed/events.jsonl",
    lastMessagePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_failed/last-message.md",
    stdoutTail: "Starting dependency scan\nResolving package metadata\n",
    stderrTail: "registry lookup timed out\nretry budget exhausted\n",
    resultSummary: "Dependency scan could not complete because npm metadata timed out.",
    findingsCount: 0,
    createdScheduleCount: 0,
  },
  {
    id: "run_running",
    taskId: "task_daily_review",
    triggerType: "manual",
    scheduledFor: minutesAgo(5),
    attempt: 1,
    status: "running",
    statusReason: undefined,
    queuedAt: minutesAgo(5),
    startedAt: minutesAgo(4),
    endedAt: undefined,
    durationMs: undefined,
    targetMode: "repo-worktree",
    workspacePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/run_running",
    worktreePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/run_running",
    branchName: "codex-scheduler/daily-review/run_running",
    baseRef: "main",
    commitBefore: "abc123",
    commitAfter: undefined,
    exitCode: undefined,
    signal: undefined,
    codexSessionId: "sess_running",
    stdoutLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_running/stdout.log",
    stderrLogPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_running/stderr.log",
    eventsJsonlPath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_running/events.jsonl",
    lastMessagePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_running/last-message.md",
    stdoutTail: "Reading specs...\nChecking current workspace...\n",
    stderrTail: "",
    resultSummary: "Review in progress.",
    findingsCount: 0,
    createdScheduleCount: 0,
  },
];

const logs = new Map<string, Record<LogStream, string>>([
  [
    "run_success",
    {
      stdout:
        "Starting Codex Scheduler review\nLoaded 18 changed files\nFinal: No critical issues found\n",
      stderr: "",
    },
  ],
  [
    "run_failed",
    {
      stdout: "Starting dependency scan\nResolving package metadata\n",
      stderr: "registry lookup timed out\nretry budget exhausted\n",
    },
  ],
  [
    "run_running",
    {
      stdout:
        "Reading specs...\nChecking current workspace...\nInspecting IPC module...\n",
      stderr: "",
    },
  ],
]);

function taskById(idValue: string) {
  const task = tasks.find((item) => item.id === idValue && item.status !== "deleted");
  if (!task) {
    throw new Error(`Task not found: ${idValue}`);
  }
  return task;
}

function runById(idValue: string) {
  const run = runs.find((item) => item.id === idValue);
  if (!run) {
    throw new Error(`Run not found: ${idValue}`);
  }
  return run;
}

function updateTaskStatus(idValue: string, status: TaskStatus) {
  const task = taskById(idValue);
  task.status = status;
  task.nextRunAt =
    status === "active" && task.kind !== "manual"
      ? task.nextRunAt ?? task.runAt ?? minutesFromNow(60)
      : undefined;
  return { task: clone(task) };
}

function createRun(taskId: string, status: RunStatus = "queued") {
  const task = taskById(taskId);
  const run: RunDto = {
    id: id("run"),
    taskId: task.id,
    triggerType: "manual",
    scheduledFor: new Date().toISOString(),
    attempt: 1,
    status,
    statusReason: undefined,
    queuedAt: new Date().toISOString(),
    startedAt: status === "queued" ? undefined : new Date().toISOString(),
    endedAt: undefined,
    durationMs: undefined,
    targetMode: task.target.mode,
    workspacePath: task.target.repoPath,
    worktreePath: undefined,
    branchName: undefined,
    baseRef: task.target.baseRef,
    commitBefore: undefined,
    commitAfter: undefined,
    exitCode: undefined,
    signal: undefined,
    codexSessionId: undefined,
    stdoutLogPath: undefined,
    stderrLogPath: undefined,
    eventsJsonlPath: undefined,
    lastMessagePath: undefined,
    stdoutTail: "",
    stderrTail: "",
    resultSummary: "Manual run queued.",
    findingsCount: 0,
    createdScheduleCount: 0,
  };
  runs = [run, ...runs];
  logs.set(run.id, {
    stdout: "Manual run queued by UI.\nWaiting for scheduler tick.\n",
    stderr: "",
  });
  return { run: clone(run) };
}

function settingRows(key?: string) {
  const rows = Array.from(settings.values());
  return key ? rows.filter((setting) => setting.key === key) : rows;
}

export async function mockInvoke(command: string, params?: unknown): Promise<unknown> {
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  const input = (params ?? {}) as JsonObject;

  switch (command) {
    case "daemon_health": {
      const enabled = JSON.parse(
        settings.get("scheduler.enabled")?.valueJson ?? "true",
      ) as boolean;
      const health: HealthDto = {
        ok: true,
        version: "dev-mock",
        dbSchemaVersion: 1,
        schedulerEnabled: enabled,
        runningCount: runs.filter((run) => run.status === "running").length,
        queuedCount: runs.filter((run) => run.status === "queued").length,
      };
      return clone(health);
    }
    case "task_list": {
      const status = input.status as TaskStatus | undefined;
      const filtered = tasks.filter(
        (task) => task.status !== "deleted" && (!status || task.status === status),
      );
      return { tasks: clone(filtered) };
    }
    case "task_get":
      return { task: clone(taskById(input.id as string)) };
    case "task_create": {
      const task = clone(input.task as TaskDto);
      task.id = task.id || id("task");
      task.slug = task.slug || slugify(task.name) || task.id;
      tasks = [task, ...tasks];
      return { task: clone(task) };
    }
    case "task_update": {
      const task = clone(input.task as TaskDto);
      tasks = tasks.map((item) => (item.id === task.id ? task : item));
      return { task: clone(task) };
    }
    case "task_delete": {
      const task = taskById(input.id as string);
      task.status = "deleted";
      return { deleted: true };
    }
    case "task_pause":
      return updateTaskStatus(input.id as string, "paused");
    case "task_resume":
      return updateTaskStatus(input.id as string, "active");
    case "task_run_now":
      return createRun(input.id as string);
    case "run_list": {
      const taskId = input.taskId as string | undefined;
      const status = input.status as RunStatus | undefined;
      return {
        runs: clone(
          runs.filter(
            (run) =>
              (!taskId || run.taskId === taskId) && (!status || run.status === status),
          ),
        ),
      };
    }
    case "run_get":
      return { run: clone(runById(input.id as string)) };
    case "run_cancel": {
      const run = runById(input.id as string);
      run.status = "canceled";
      run.endedAt = new Date().toISOString();
      run.resultSummary = "Run canceled from UI.";
      return { run: clone(run) };
    }
    case "run_tail_log": {
      const runId = input.runId as string;
      const stream = (input.stream as LogStream | undefined) ?? "stdout";
      const cursor = Number(input.cursor ?? 0);
      const limit = Number(input.limit ?? 8192);
      const data = logs.get(runId)?.[stream] ?? "";
      const chunk = data.slice(cursor, cursor + limit);
      return {
        runId,
        stream,
        cursor,
        nextCursor: cursor + chunk.length,
        eof: cursor + chunk.length >= data.length,
        data: chunk,
      };
    }
    case "project_list":
      return { projects: clone(projects) };
    case "project_trust": {
      const path = String(input.path ?? "").trim();
      const project: ProjectDto = {
        id: id("proj"),
        name: path.split("/").filter(Boolean).at(-1) ?? "Project",
        path,
        kind: path.includes(".git") ? "git" : "folder",
        gitRoot: path,
        gitRemoteUrl: undefined,
        defaultBranch: "main",
        trustedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      projects = [project, ...projects.filter((item) => item.path !== path)];
      return { project: clone(project) };
    }
    case "settings_get":
      return { settings: clone(settingRows(input.key as string | undefined)) };
    case "settings_set": {
      const key = input.key as keyof SchedulerSettings;
      const setting: SettingDto = {
        key,
        valueJson: JSON.stringify(input.value),
        updatedAt: new Date().toISOString(),
      };
      settings.set(key, setting);
      return { setting: clone(setting) };
    }
    default:
      throw new Error(`Mock command not implemented: ${command}`);
  }
}
