import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskWizard } from "@/components/task-wizard";
import { ipcClient } from "@/lib/ipc";
import { buildTaskDto, defaultTaskDraft, taskToDraft } from "@/lib/task-draft";
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

    const cronInput = screen.getByLabelText("カスタム cron 式");
    await user.clear(cronInput);
    await user.type(cronInput, "0 0 1 1 * *");

    expect(
      await screen.findByText(
        "秒フィールドはサポートしていません。5フィールドの cron 式を使ってください。",
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
    expect(preview).toHaveTextContent("次の5回");
    expect(preview.querySelectorAll("span")).toHaveLength(5);
  });

  it("shows the default cron cadence as the matching schedule preset", () => {
    const draft = defaultTaskDraft();

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(draft.scheduleMode).toBe("preset");
    expect(draft.presetMode).toBe("weekdays");
    expect(draft.cronExpr).toBe("0 9 * * 1-5");
    expect(buildTaskDto(draft, false).cronExpr).toBe("0 9 * * 1-5");
    expect(screen.getByRole("combobox", { name: "実行タイミング" })).toHaveTextContent(
      "平日",
    );
    expect(screen.queryByLabelText("カスタム cron 式")).not.toBeInTheDocument();
    expect(screen.getByText("平日 09:00")).toBeInTheDocument();
  });

  it("maps matching cron tasks back to presets for editing", () => {
    const sourceDraft = {
      ...defaultTaskDraft(),
      name: "Weekly review",
      prompt: "Review the repository.",
      scheduleMode: "cron" as const,
      cronExpr: "30 8 * * 1",
    };
    const task = buildTaskDto(sourceDraft, false);

    const draft = taskToDraft(task);

    expect(draft.scheduleMode).toBe("preset");
    expect(draft.presetMode).toBe("weekly");
    expect(draft.presetTime).toBe("08:30");
    expect(draft.weeklyDay).toBe("1");
    expect(draft.cronExpr).toBe("30 8 * * 1");
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

    await user.click(screen.getByText("詳細設定"));

    expect(
      screen.getByLabelText("ファイルシステムのフルアクセスのリスクを理解しています"),
    ).toBeInTheDocument();
    expect(screen.getByText("任意のスケジュールを更新できます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "フォルダを選択" })).toBeInTheDocument();
  });

  it("shows inline required-field errors from the one-screen composer", async () => {
    const user = userEvent.setup();

    renderWithClient(<TaskWizard />);

    await user.click(screen.getByRole("button", { name: "タスクを作成" }));

    expect(await screen.findByText("確認が必要な項目があります")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "プロンプト: プロンプトは必須です。" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "タスク名: タスク名は必須です。" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("タスク名は必須です。", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getByText("プロンプトは必須です。", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByLabelText("プロンプト")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("タスク名")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("プロンプト")).toHaveFocus());
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

    await user.click(screen.getByRole("button", { name: "タスクを作成" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith(expectedDto);
  });

  it("notifies the parent with the created task after create succeeds", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const draft = {
      ...defaultTaskDraft(),
      name: "Create callback",
      prompt: "Create a task and return it to the route.",
    };
    const expectedDto = buildTaskDto(draft, false);
    const createdTask = {
      ...expectedDto,
      id: "task_created",
    };
    vi.spyOn(ipcClient, "taskCreate").mockResolvedValue(createdTask);

    renderWithClient(<TaskWizard initialDraft={draft} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "タスクを作成" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(createdTask));
  });
});
