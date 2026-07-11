import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskHeaderActions } from "@/components/task-actions";
import { ipcClient } from "@/lib/ipc";
import type { TaskDto } from "@/lib/types";
import { renderWithClient } from "./test-utils";

const activeTask: TaskDto = {
  id: "task_test",
  slug: "task-test",
  name: "Task Test",
  status: "active",
  locked: false,
  kind: "manual",
  timezone: "UTC",
  target: { mode: "chat" },
  codex: {
    model: "gpt-5.5",
    reasoningEffort: "medium",
  },
  prompt: {
    body: "Test",
  },
};

const pausedTask: TaskDto = {
  ...activeTask,
  status: "paused",
};

describe("TaskHeaderActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("separates primary execution, schedule state, and management actions", async () => {
    const user = userEvent.setup();

    renderWithClient(<TaskHeaderActions task={activeTask} />);

    expect(
      screen.getByRole("button", { name: "Task Testを今すぐ実行" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Task Testを一時停止" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Task Testの管理" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Task Testを複製" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Task Testの管理" }));

    expect(screen.getByText("タスク管理")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Task Testを複製" }),
    ).toHaveAttribute("href", "/tasks/new?duplicateFromTask=task_test");
    expect(
      screen.getByRole("menuitem", { name: "Task Testをロック" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Task Testを削除" }),
    ).toBeInTheDocument();
  });

  it("runs the task from the primary action", async () => {
    const user = userEvent.setup();
    const runSpy = vi.spyOn(ipcClient, "taskRunNow").mockResolvedValue({
      id: "run_test",
      taskId: "task_test",
      triggerType: "manual",
      status: "queued",
      findingsCount: 0,
      createdScheduleCount: 0,
      artifacts: [],
    });

    renderWithClient(<TaskHeaderActions task={activeTask} />);

    await user.click(
      screen.getByRole("button", { name: "Task Testを今すぐ実行" }),
    );

    await waitFor(() => expect(runSpy).toHaveBeenCalledWith("task_test"));
  });

  it("pauses active tasks without opening a menu", async () => {
    const user = userEvent.setup();
    const pauseSpy = vi
      .spyOn(ipcClient, "taskPause")
      .mockResolvedValue({ ...activeTask, status: "paused" });

    renderWithClient(<TaskHeaderActions task={activeTask} />);

    await user.click(
      screen.getByRole("button", { name: "Task Testを一時停止" }),
    );

    await waitFor(() => expect(pauseSpy).toHaveBeenCalledWith("task_test"));
  });

  it("resumes paused tasks without opening a menu", async () => {
    const user = userEvent.setup();
    const resumeSpy = vi
      .spyOn(ipcClient, "taskResume")
      .mockResolvedValue({ ...activeTask, status: "active" });

    renderWithClient(<TaskHeaderActions task={pausedTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testを再開" }));

    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith("task_test"));
  });

  it("shows lock state on management and unlocks from the menu", async () => {
    const user = userEvent.setup();
    const lockedTask = { ...activeTask, locked: true };
    const updateSpy = vi
      .spyOn(ipcClient, "taskUpdate")
      .mockResolvedValue({ ...lockedTask, locked: false });

    renderWithClient(<TaskHeaderActions task={lockedTask} />);

    const management = screen.getByRole("button", {
      name: "Task Testの管理（ロック中）",
    });
    await user.click(management);
    await user.click(
      screen.getByRole("menuitem", { name: "Task Testのロックを解除" }),
    );

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({ ...lockedTask, locked: false }),
    );
  });

  it("keeps desktop state and delete actions available for locked tasks", async () => {
    const user = userEvent.setup();
    const lockedTask = { ...activeTask, locked: true };

    renderWithClient(<TaskHeaderActions task={lockedTask} />);

    expect(
      screen.getByRole("button", { name: "Task Testを一時停止" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Task Testの管理（ロック中）" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Task Testを削除" }),
    ).not.toHaveAttribute("data-disabled");
  });

  it("confirms deletion from the management menu", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(ipcClient, "taskDelete").mockResolvedValue(true);

    renderWithClient(<TaskHeaderActions task={activeTask} />);

    await user.click(screen.getByRole("button", { name: "Task Testの管理" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Task Testを削除" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "タスクを削除" }),
    );

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("task_test"));
  });
});
