import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskWizard } from "@/components/task-wizard";
import { ipcClient } from "@/lib/ipc";
import { buildTaskDto, defaultTaskDraft } from "@/lib/task-draft";
import { renderWithClient } from "./test-utils";

describe("TaskWizard cron validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a 6-field cron error inline", async () => {
    const user = userEvent.setup();
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "0 9 * * 1-5",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    const cronInput = screen.getByLabelText("Custom cron expression");
    await user.clear(cronInput);
    await user.type(cronInput, "0 0 1 1 * *");

    expect(
      await screen.findByText(
        "Seconds are not supported. Use a 5-field cron expression.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the next five cron preview entries", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "*/15 * * * *",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    const preview = screen.getByTestId("cron-preview");
    expect(preview).toHaveTextContent("Next 5 runs");
    expect(preview.querySelectorAll("span")).toHaveLength(5);
  });

  it("shows hardening warnings in advanced settings", async () => {
    const user = userEvent.setup();
    const draft = {
      ...defaultTaskDraft(),
      name: "Danger task",
      prompt: "Run with broad permissions.",
      targetMode: "repo-local" as const,
      repoPath: "/tmp/repo",
      sandboxMode: "danger-full-access" as const,
      allowScheduleCli: true,
      capabilities: ["schedule:create", "schedule:update-any"],
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    await user.click(screen.getByText("Advanced settings"));

    expect(
      screen.getByLabelText("I understand the risk of full filesystem access"),
    ).toBeInTheDocument();
    expect(screen.getByText("Can update any schedule")).toBeInTheDocument();
    expect(screen.getByText("Not trusted")).toBeInTheDocument();
  });

  it("shows inline required-field errors from the one-screen composer", async () => {
    const user = userEvent.setup();

    renderWithClient(<TaskWizard />);

    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Task name is required.")).toBeInTheDocument();
    expect(screen.getByText("Prompt is required.")).toBeInTheDocument();
  });

  it("submits the existing task DTO shape through the create mutation", async () => {
    const user = userEvent.setup();
    const draft = {
      ...defaultTaskDraft(),
      name: "Daily review",
      description: "Summarize repository risk.",
      prompt: "Review the repository and report the riskiest changes.",
      targetMode: "repo-worktree" as const,
      projectId: "proj_demo",
      repoPath: "/Users/alice/src/my-app",
      baseRef: "main",
      scheduleMode: "preset" as const,
      presetMode: "daily" as const,
      presetTime: "09:00",
      timezone: "UTC",
      sandboxMode: "workspace-write" as const,
      capabilities: ["schedule:create", "schedule:list"],
      maxCreatedSchedulesPerRun: 3,
    };
    const expectedDto = buildTaskDto(draft, false);
    const createSpy = vi.spyOn(ipcClient, "taskCreate").mockResolvedValue({
      ...expectedDto,
      id: "task_created",
    });

    renderWithClient(<TaskWizard initialDraft={draft} />);

    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith(expectedDto);
  });
});
