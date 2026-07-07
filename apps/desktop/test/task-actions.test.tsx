import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
    model: "gpt-5-codex",
    reasoningEffort: "default",
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

describe("TaskRowActions", () => {
  it("calls pause mutation for active tasks", async () => {
    const user = userEvent.setup();
    const pauseSpy = vi
      .spyOn(ipcClient, "taskPause")
      .mockResolvedValue({ ...activeTask, status: "paused" });

    renderWithClient(<TaskRowActions task={activeTask} />);

    await user.click(screen.getByLabelText("Task Test を一時停止"));

    await waitFor(() => expect(pauseSpy).toHaveBeenCalledWith("task_test"));
    pauseSpy.mockRestore();
  });
});
