import { describe, expect, it } from "vitest";

import {
  projectDtoSchema,
  runDtoSchema,
  taskDtoSchema,
} from "@/lib/types";

describe("DTO schemas", () => {
  it("parses TaskDto and RunDto shapes from Rust IPC", () => {
    const task = taskDtoSchema.parse({
      id: "task_1",
      slug: "daily-review",
      name: "Daily review",
      status: "active",
      kind: "cron",
      cronExpr: "0 9 * * 1-5",
      timezone: "Asia/Tokyo",
      nextRunAt: "2026-07-08T00:00:00Z",
      target: {
        mode: "repo-worktree",
        projectId: "proj_1",
        repoPath: "/tmp/repo",
        baseRef: "main",
      },
      codex: {
        model: "gpt-5-codex",
        reasoningEffort: "default",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
      prompt: {
        body: "Review changes.",
        injectSchedulerInstructions: true,
      },
      policies: {
        allowScheduleCli: true,
        missedPolicy: "latest_within_window",
        overlapPolicy: "skip",
        maxRuntimeSec: 7200,
      },
    });

    const run = runDtoSchema.parse({
      id: "run_1",
      taskId: task.id,
      triggerType: "schedule",
      scheduledFor: "2026-07-08T00:00:00Z",
      attempt: 2,
      status: "succeeded",
      statusReason: null,
      queuedAt: "2026-07-08T00:00:00Z",
      startedAt: "2026-07-08T00:00:03Z",
      endedAt: "2026-07-08T00:03:42Z",
      durationMs: 219000,
      targetMode: "repo-worktree",
      workspacePath: "/tmp/worktree",
      worktreePath: "/tmp/worktree",
      branchName: "codex-scheduler/daily/run_1",
      baseRef: "main",
      commitBefore: "abc123",
      commitAfter: "def456",
      exitCode: 0,
      signal: null,
      stdoutTail: "ok\n",
      stderrTail: null,
      codexSessionId: "sess_1",
      stdoutLogPath: "/tmp/run_1/stdout.log",
      stderrLogPath: "/tmp/run_1/stderr.log",
      eventsJsonlPath: "/tmp/run_1/events.jsonl",
      lastMessagePath: "/tmp/run_1/last-message.md",
      resultSummary: "No critical issues.",
      findingsCount: 2,
      createdScheduleCount: 1,
    });

    expect(task.target.projectId).toBe("proj_1");
    expect(run.attempt).toBe(2);
    expect(run.commitAfter).toBe("def456");
    expect(run.findingsCount).toBe(2);
    expect(run.createdScheduleCount).toBe(1);
  });

  it("parses camelCase Project rows from IPC", () => {
    const project = projectDtoSchema.parse({
      id: "proj_1",
      name: "repo",
      path: "/tmp/repo",
      kind: "git",
      gitRoot: "/tmp/repo",
      gitRemoteUrl: null,
      defaultBranch: "main",
      trustedAt: "2026-07-08T00:00:00Z",
      createdAt: "2026-07-08T00:00:00Z",
      updatedAt: "2026-07-08T00:00:00Z",
    });

    expect(project.gitRoot).toBe("/tmp/repo");
    expect(project.defaultBranch).toBe("main");
  });
});
