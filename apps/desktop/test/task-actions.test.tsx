import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskRowActions } from "@/components/task-actions";
import { ipcClient } from "@/lib/ipc";
import type { TaskDto } from "@/lib/types";
import { renderWithClient } from "./test-utils";

const activeTask: TaskDto = {
  id: "task_test",
  slug: "task-test",
  name: "Task Test",
  description: "Task for mutation test",
  status: "active",
  kind: "manual",
  timezone: "UTC",
  target: { mode: "chat" },
  codex: {
    model: "gpt-5.5",
    reasoningEffort: "medium",
    sandboxMode: "read-only",
    approvalPolicy: "never",
  },
  prompt: {
    body: "Test",
    injectSchedulerInstructions: true,
  },
  policies: {
    allowScheduleCli: true,
    missedPolicy: "skip",
    overlapPolicy: "skip",
    maxRuntimeSec: 300,
  },
};

const pausedTask: TaskDto = {
  ...activeTask,
  status: "paused",
};

describe("TaskRowActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps run now as the primary visible action", async () => {
    const user = userEvent.setup();
    const runSpy = vi.spyOn(ipcClient, "taskRunNow").mockResolvedValue({
      id: "run_test",
      taskId: "task_test",
      triggerType: "manual",
      status: "queued",
      findingsCount: 0,
      createdScheduleCount: 0,
    });

    renderWithClient(<TaskRowActions task={activeTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testを今すぐ実行" }));

    await waitFor(() => expect(runSpy).toHaveBeenCalledWith("task_test"));
  });

  it("opens overflow before pausing active tasks", async () => {
    const user = userEvent.setup();
    const pauseSpy = vi
      .spyOn(ipcClient, "taskPause")
      .mockResolvedValue({ ...activeTask, status: "paused" });

    renderWithClient(<TaskRowActions task={activeTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testのその他の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "Task Testを一時停止" }));

    await waitFor(() => expect(pauseSpy).toHaveBeenCalledWith("task_test"));
  });

  it("opens overflow before resuming paused tasks", async () => {
    const user = userEvent.setup();
    const resumeSpy = vi
      .spyOn(ipcClient, "taskResume")
      .mockResolvedValue({ ...activeTask, status: "active" });

    renderWithClient(<TaskRowActions task={pausedTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testのその他の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "Task Testを再開" }));

    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith("task_test"));
  });

  it("opens overflow before editing tasks", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    renderWithClient(<TaskRowActions task={activeTask} onEdit={onEdit} />);

    await user.click(screen.getByRole("button", { name: "Task Testのその他の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "Task Testを編集" }));

    expect(onEdit).toHaveBeenCalledWith(activeTask);
  });

  it("opens overflow before confirming task deletion", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(ipcClient, "taskDelete").mockResolvedValue(true);

    renderWithClient(<TaskRowActions task={activeTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testのその他の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "Task Testを削除" }));
    await user.click(await screen.findByRole("button", { name: "タスクを削除" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("task_test"));
  });
});
