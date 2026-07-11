import { longCodexEventLog } from "@/lib/mock-long-codex-log";
import type {
  DaemonDiagnostics,
  HealthDto,
  LogStream,
  ProjectDto,
  RunArtifactDto,
  RunDto,
  RunStatus,
  SchedulerSettings,
  SettingDto,
  TaskAuditEvent,
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

function jsonLines(...events: JsonObject[]) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function worktreeInstanceName() {
  return `wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    name: "毎日のリポジトリレビュー",
    status: "active",
    locked: true,
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
      model: "gpt-5.5",
      reasoningEffort: "medium",
    },
    prompt: {
      body: "最新の scheduler 変更をレビューし、リグレッションを要約してください。",
    },
    auditEvents: [
      {
        id: "audit_daily_update",
        taskId: "task_daily_review",
        actorType: "user",
        actorId: undefined,
        action: "task.update",
        beforeJson: {
          status: "paused",
          codex: { model: "gpt-5.4" },
        },
        afterJson: {
          status: "active",
          codex: { model: "gpt-5.5" },
        },
        reason: "デスクトップ UI から設定を調整",
        createdAt: minutesAgo(60),
      },
      {
        id: "audit_daily_create",
        taskId: "task_daily_review",
        actorType: "user",
        actorId: undefined,
        action: "task.create",
        beforeJson: undefined,
        afterJson: { name: "毎日のリポジトリレビュー" },
        reason: undefined,
        createdAt: createdAt,
      },
    ],
  },
  {
    id: "task_dependency_scan",
    slug: "dependency-scan",
    name: "依存関係スキャン",
    status: "paused",
    locked: false,
    kind: "cron",
    cronExpr: "30 8 * * 1",
    runAt: undefined,
    timezone: "Asia/Tokyo",
    nextRunAt: undefined,
    target: {
      mode: "repo-worktree",
      projectId: "proj_demo",
      repoPath: "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
      baseRef: "main",
    },
    codex: {
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
    },
    prompt: {
      body: "古い依存関係を探し、安全な更新計画を提案してください。",
    },
  },
  {
    id: "task_release_notes",
    slug: "release-notes",
    name: "リリースノート下書き",
    status: "active",
    locked: false,
    kind: "once",
    cronExpr: undefined,
    runAt: minutesFromNow(360),
    timezone: "Asia/Tokyo",
    nextRunAt: minutesFromNow(360),
    target: { mode: "chat", projectId: undefined, repoPath: undefined },
    codex: {
      model: "gpt-5.4",
      reasoningEffort: "medium",
    },
    prompt: {
      body: "最新のマージ済み作業からリリースノートの下書きを作成してください。",
    },
  },
  {
    id: "task_weather_check",
    slug: "tokyo-weather-check",
    name: "東京の天気とフォローアップ",
    status: "completed",
    locked: false,
    kind: "once",
    cronExpr: undefined,
    runAt: minutesAgo(120),
    timezone: "Asia/Tokyo",
    nextRunAt: undefined,
    target: { mode: "chat", projectId: undefined, repoPath: undefined },
    codex: {
      model: "gpt-5.5",
      reasoningEffort: "medium",
    },
    prompt: {
      body: "東京の今日の天気を調べ、2時間後に再確認するタスクも登録してください。",
    },
  },
];

function taskAuditEvents(taskId: string): TaskAuditEvent[] {
  return clone(taskById(taskId).auditEvents ?? []);
}

let runs: RunDto[] = [
  {
    id: "run_demo_long",
    taskId: "task_weather_check",
    triggerType: "schedule",
    scheduledFor: minutesAgo(120),
    attempt: 1,
    status: "succeeded",
    statusReason: undefined,
    queuedAt: minutesAgo(120),
    startedAt: minutesAgo(119),
    endedAt: minutesAgo(114),
    durationMs: 300_000,
    targetMode: "chat",
    workspacePath: undefined,
    worktreePath: undefined,
    branchName: undefined,
    baseRef: undefined,
    commitBefore: undefined,
    commitAfter: undefined,
    exitCode: 0,
    signal: undefined,
    codexSessionId: "thread_demo_long",
    stdoutLogPath:
      "/Users/demo/Library/Application Support/Codex Scheduler/logs/run_demo_long/stdout.log",
    stderrLogPath:
      "/Users/demo/Library/Application Support/Codex Scheduler/logs/run_demo_long/stderr.log",
    eventsJsonlPath:
      "/Users/demo/Library/Application Support/Codex Scheduler/logs/run_demo_long/events.jsonl",
    lastMessagePath:
      "/Users/demo/Library/Application Support/Codex Scheduler/logs/run_demo_long/last-message.md",
    stdoutTail: "東京の天気と再チェック時刻を確認しました。\n",
    stderrTail: "",
    resultSummary:
      "東京は晴れ時々くもりで、2時間後の再チェックを設定しました。",
    findingsCount: 0,
    createdScheduleCount: 1,
  },
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
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/wt-01900000-0000-7000-8000-000000000001",
    worktreePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/wt-01900000-0000-7000-8000-000000000001",
    branchName:
      "codex-scheduler/daily-review/wt-01900000-0000-7000-8000-000000000001",
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
    stdoutTail: "Final: 重大な問題は見つかりませんでした\n",
    stderrTail: "",
    resultSummary: "重大な問題は見つかりませんでした。フォローアップメモを2件記録しました。",
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
    statusReason: "パッケージメタデータの取得に失敗した後、Codex はコード 1 で終了しました。",
    queuedAt: minutesAgo(90),
    startedAt: minutesAgo(89),
    endedAt: minutesAgo(84),
    durationMs: 300_000,
    targetMode: "repo-worktree",
    workspacePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/dependency-scan/wt-01900000-0000-7000-8000-000000000002",
    worktreePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/dependency-scan/wt-01900000-0000-7000-8000-000000000002",
    branchName:
      "codex-scheduler/dependency-scan/wt-01900000-0000-7000-8000-000000000002",
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
    stdoutTail: "依存関係スキャンを開始しています\nパッケージメタデータを解決しています\n",
    stderrTail: "registry lookup timed out\nretry budget exhausted\n",
    resultSummary: "npm メタデータがタイムアウトしたため、依存関係スキャンを完了できませんでした。",
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
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/wt-01900000-0000-7000-8000-000000000003",
    worktreePath:
      "/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/daily-review/wt-01900000-0000-7000-8000-000000000003",
    branchName:
      "codex-scheduler/daily-review/wt-01900000-0000-7000-8000-000000000003",
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
    stdoutTail: "仕様を読んでいます...\n現在のワークスペースを確認しています...\n",
    stderrTail: "",
    resultSummary: "レビュー中です。",
    findingsCount: 0,
    createdScheduleCount: 0,
  },
];

const logs = new Map<string, Record<LogStream, string>>([
  [
    "run_demo_long",
    {
      stdout: "東京の天気と再チェック時刻を確認しました。\n",
      stderr: "",
      events: longCodexEventLog,
    },
  ],
  [
    "run_success",
    {
      stdout:
        "Codex Scheduler レビューを開始しています\n18 件の変更ファイルを読み込みました\nFinal: 重大な問題は見つかりませんでした\n",
      stderr: "",
      events: jsonLines(
        { type: "thread.started", thread_id: "sess_success" },
        { type: "turn.started" },
        {
          type: "item.started",
          item: {
            id: "item_command_review",
            type: "command_execution",
            command: "git diff --stat origin/main...HEAD",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_command_review",
            type: "command_execution",
            command: "git diff --stat origin/main...HEAD",
            aggregated_output:
              "apps/desktop/components/run-detail.tsx | 128 +++++++++++++\n1 file changed, 96 insertions(+), 32 deletions(-)",
            exit_code: 0,
            status: "completed",
          },
        },
        {
          type: "item.started",
          item: {
            id: "item_search_release",
            type: "web_search",
            query: "Next.js 15 release notes",
            action: { type: "search", query: "Next.js 15 release notes" },
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_search_release",
            type: "web_search",
            query: "Next.js 15 release notes",
            action: { type: "search", query: "Next.js 15 release notes" },
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_final",
            type: "agent_message",
            text: "重大な問題は見つかりませんでした。フォローアップメモを2件記録しました。",
          },
        },
        { type: "turn.completed", usage: { input_tokens: 8420, output_tokens: 614 } },
      ),
    },
  ],
  [
    "run_failed",
    {
      stdout: "依存関係スキャンを開始しています\nパッケージメタデータを解決しています\n",
      stderr: "registry lookup timed out\nretry budget exhausted\n",
      events: jsonLines(
        { type: "thread.started", thread_id: "sess_failed" },
        { type: "turn.started" },
        {
          type: "item.started",
          item: {
            id: "item_command_dependencies",
            type: "command_execution",
            command: "pnpm outdated --json",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_command_dependencies",
            type: "command_execution",
            command: "pnpm outdated --json",
            aggregated_output: "registry lookup timed out\nretry budget exhausted",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          type: "turn.failed",
          error: { message: "パッケージメタデータを取得できませんでした。" },
        },
      ),
    },
  ],
  [
    "run_running",
    {
      stdout:
        "仕様を読んでいます...\n現在のワークスペースを確認しています...\nIPC モジュールを調査しています...\n",
      stderr: "",
      events: jsonLines(
        { type: "thread.started", thread_id: "sess_running" },
        { type: "turn.started" },
        {
          type: "item.started",
          item: {
            id: "item_command_running",
            type: "command_execution",
            command: "rg --files apps/desktop",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        },
      ),
    },
  ],
]);

const artifacts = new Map<string, RunArtifactDto[]>([
  [
    "run_success",
    [
      {
        id: "artifact_last_message",
        runId: "run_success",
        kind: "last-message",
        path:
          "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/last-message.md",
        title: "最後のメッセージ",
        mimeType: "text/markdown",
        sizeBytes: 512,
        createdAt,
      },
      {
        id: "artifact_diff",
        runId: "run_success",
        kind: "diff",
        path:
          "/Users/aki-0421/Library/Application Support/Codex Scheduler/logs/run_success/changes.diff",
        title: "Git diff",
        mimeType: "text/x-diff",
        sizeBytes: 2048,
        createdAt,
      },
    ],
  ],
]);

function taskById(idValue: string) {
  const task = tasks.find((item) => item.id === idValue && item.status !== "deleted");
  if (!task) {
    throw new Error(`タスクが見つかりません: ${idValue}`);
  }
  return task;
}

function runById(idValue: string) {
  const run = runs.find((item) => item.id === idValue);
  if (!run) {
    throw new Error(`実行が見つかりません: ${idValue}`);
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

function activeTaskCountForProject(project: ProjectDto) {
  return tasks.filter(
    (task) =>
      task.status === "active" &&
      (task.target.projectId === project.id ||
        task.target.repoPath === project.path ||
        task.target.repoPath === project.gitRoot),
  ).length;
}

function createRun(taskId: string, status: RunStatus = "queued") {
  const task = taskById(taskId);
  const worktreeName =
    task.target.mode === "repo-worktree" ? worktreeInstanceName() : undefined;
  const worktreePath = worktreeName
    ? `/Users/aki-0421/Library/Application Support/Codex Scheduler/worktrees/${task.slug}/${worktreeName}`
    : undefined;
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
    workspacePath: worktreePath ?? task.target.repoPath,
    worktreePath,
    branchName: worktreeName
      ? `codex-scheduler/${task.slug}/${worktreeName}`
      : undefined,
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
    resultSummary: "手動実行をキューに追加しました。",
    findingsCount: 0,
    createdScheduleCount: 0,
  };
  runs = [run, ...runs];
  logs.set(run.id, {
    stdout: "UI から手動実行をキューに追加しました。\nscheduler tick を待っています。\n",
    stderr: "",
    events:
      "{\"event_type\":\"run.queued\",\"message\":\"UI から手動実行をキューに追加しました\"}\n",
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
        dbSchemaVersion: 6,
        schedulerEnabled: enabled,
        runningCount: runs.filter((run) => run.status === "running").length,
        queuedCount: runs.filter((run) => run.status === "queued").length,
      };
      return clone(health);
    }
    case "daemon_diagnostics": {
      const codexPath = JSON.parse(
        settings.get("runner.codex_path")?.valueJson ?? "\"codex\"",
      ) as string;
      const enabled = JSON.parse(
        settings.get("scheduler.enabled")?.valueJson ?? "true",
      ) as boolean;
      const diagnostics: DaemonDiagnostics = {
        version: "dev-mock",
        dbSchemaVersion: 6,
        dataDir: "/tmp/codex-scheduler",
        socketPath: "/tmp/codex-scheduler/scheduler.sock",
        dbSizeBytes: 4096,
        logsSizeBytes: 8192,
        taskCounts: { active: tasks.filter((task) => task.status === "active").length },
        runCounts: { failed: runs.filter((run) => run.status === "failed").length },
        schedulerEnabled: enabled,
        codexPath: {
          value: codexPath,
          exists: codexPath === "codex" || codexPath.startsWith("/"),
        },
        tickIntervalSec: 60,
        lastTickAt: minutesAgo(2),
      };
      return clone(diagnostics);
    }
    case "daemon_tick_now":
      return { ok: true, triggered: true };
    case "diagnostics_export":
      return "/tmp/codex-scheduler-diagnostics.json";
    case "export_run_logs":
      return `/tmp/codex-scheduler-${input.runId as string}-logs.txt`;
    case "prompt_import_file":
      return "モックファイルからインポートしたプロンプトです。\n";
    case "task_list": {
      const status = input.status as TaskStatus | undefined;
      const filtered = tasks.filter(
        (task) => task.status !== "deleted" && (!status || task.status === status),
      );
      return { tasks: clone(filtered) };
    }
    case "task_get":
      return { task: clone(taskById(input.id as string)) };
    case "task_audit_list": {
      const limit = Number(input.limit ?? 50);
      return {
        auditEvents: taskAuditEvents(input.taskId as string).slice(0, limit),
      };
    }
    case "task_create": {
      const task = clone(input.task as TaskDto);
      task.id = task.id || id("task");
      task.slug = task.slug || slugify(task.name) || task.id;
      task.locked = task.locked ?? false;
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
      return {
        run: clone(runById(input.id as string)),
        artifacts: clone(artifacts.get(input.id as string) ?? []),
      };
    case "run_cancel": {
      const run = runById(input.id as string);
      run.status = "canceled";
      run.endedAt = new Date().toISOString();
      run.resultSummary = "UI から実行をキャンセルしました。";
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
        name: path.split("/").filter(Boolean).at(-1) ?? "プロジェクト",
        path,
        kind: "git",
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
    case "project_untrust": {
      const projectId = String(input.projectId ?? "").trim();
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error(`プロジェクトが見つかりません: ${projectId}`);
      }
      const affectedTaskCount = activeTaskCountForProject(project);
      project.trustedAt = undefined;
      project.updatedAt = new Date().toISOString();
      return { project: clone(project), affectedTaskCount };
    }
    case "project_pick_folder":
      return projects[0]?.path;
    case "open_path":
      return null;
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
