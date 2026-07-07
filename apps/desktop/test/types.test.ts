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
      status: "succeeded",
      startedAt: "2026-07-08T00:00:03Z",
      endedAt: "2026-07-08T00:03:42Z",
      workspacePath: "/tmp/worktree",
      exitCode: 0,
      resultSummary: "No critical issues.",
    });

    expect(task.target.projectId).toBe("proj_1");
    expect(run.findingsCount).toBe(0);
    expect(run.createdScheduleCount).toBe(0);
  });

  it("normalizes snake_case Project rows from current Rust structs", () => {
    const project = projectDtoSchema.parse({
      id: "proj_1",
      name: "repo",
      path: "/tmp/repo",
      kind: "git",
      git_root: "/tmp/repo",
      git_remote_url: null,
      default_branch: "main",
      trusted_at: "2026-07-08T00:00:00Z",
      created_at: "2026-07-08T00:00:00Z",
      updated_at: "2026-07-08T00:00:00Z",
    });

    expect(project.gitRoot).toBe("/tmp/repo");
    expect(project.defaultBranch).toBe("main");
  });
});
