import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskWizard } from "@/components/task-wizard";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  codexModelOptions,
  defaultCodexModel,
  defaultReasoningEffort,
  defaultReasoningEffortForModel,
  reasoningEffortOptionsForModel,
} from "@/lib/codex-options";
import { ipcClient } from "@/lib/ipc";
import {
  buildTaskDto,
  defaultTaskDraft,
  taskToDraft,
  validateTaskDraft,
} from "@/lib/task-draft";
import { getSystemTimezone } from "@/lib/timezone";
import { renderWithClient } from "./test-utils";

describe("TaskWizard cron validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a 6-field cron error inline", async () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "0 9 * * 1-5",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    const cronInput = screen.getByLabelText("カスタム cron 式");
    const createButton = screen.getByRole("button", {
      name: "タスクを作成",
    });
    expect(createButton).toBeEnabled();

    fireEvent.change(cronInput, { target: { value: "" } });
    expect(createButton).toBeDisabled();
    fireEvent.change(cronInput, { target: { value: "0 0 1 1 * *" } });

    expect(
      await screen.findByText(
        "秒フィールドはサポートしていません。5フィールドの cron 式を使ってください。",
      ),
    ).toBeInTheDocument();
    expect(createButton).toBeDisabled();

    fireEvent.change(cronInput, { target: { value: "*/15 * * * *" } });
    expect(createButton).toBeEnabled();
  });

  it("does not render execution timing previews", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "*/15 * * * *",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(screen.queryByTestId("cron-preview")).not.toBeInTheDocument();
    expect(screen.queryByText("次の5回")).not.toBeInTheDocument();
  });

  it("shows the default cron cadence as the matching schedule preset", async () => {
    const draft = defaultTaskDraft();

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(draft.scheduleMode).toBe("preset");
    expect(draft.presetMode).toBe("weekdays");
    expect(draft.cronExpr).toBe("0 9 * * 1-5");
    expect(buildTaskDto(draft, false).cronExpr).toBe("0 9 * * 1-5");
    expect(
      screen.getByRole("combobox", { name: "スケジュール" }),
    ).toHaveTextContent("平日");
    expect(screen.queryByLabelText("カスタム cron 式")).not.toBeInTheDocument();
    expect(screen.queryByText("平日 09:00")).not.toBeInTheDocument();
  });

  it("uses the PC timezone without presenting timezone UI", () => {
    const draft = {
      ...defaultTaskDraft(),
      timezone: "America/New_York",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(
      screen.queryByRole("combobox", { name: "タイムゾーン" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/PCのタイムゾーン/),
    ).not.toBeInTheDocument();
  });

  it("uses only the task name and prompt for task content", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Focused task",
      prompt: "Review the repository.",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(screen.queryByLabelText("説明")).not.toBeInTheDocument();
    expect(buildTaskDto(draft, false)).not.toHaveProperty("description");
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

  it("normalizes an existing task to the current PC timezone for editing", () => {
    const task = buildTaskDto(
      {
        ...defaultTaskDraft(),
        name: "Existing schedule",
        prompt: "Keep the schedule aligned with this PC.",
      },
      false,
    );
    task.timezone = "Pacific/Honolulu";

    expect(taskToDraft(task).timezone).toBe(getSystemTimezone());
  });

  it("normalizes a legacy local repository task to project worktree mode", () => {
    const task = buildTaskDto(
      {
        ...defaultTaskDraft(),
        name: "Legacy local task",
        prompt: "Move this task to an isolated worktree.",
      },
      false,
    );
    task.target.mode = "repo-local";

    expect(taskToDraft(task).targetMode).toBe("repo-worktree");
  });

  it("places task and model fields without a separator between them", () => {
    renderWithClient(<TaskWizard />);

    const basicSettings = screen.getByRole("region", { name: "基本設定" });
    const modelSettings = screen.getByRole("region", { name: "モデル設定" });

    expect(basicSettings.nextElementSibling).toBe(modelSettings);
  });

  it("selects chat or project with radio cards", async () => {
    const user = userEvent.setup();

    renderWithClient(<TaskWizard />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "基本設定" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "モデル設定" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "実行内容とオプション" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "オプション" }),
    ).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: /チャット/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /プロジェクト/ }));

    expect(screen.getByRole("radio", { name: /プロジェクト/ })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Gitプロジェクト" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gitリポジトリを追加" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ベース参照")).not.toBeInTheDocument();
    expect(
      screen.queryByText("登録した作業ツリーは変更せず、実行ごとに分離ワークツリーを作成します。"),
    ).not.toBeInTheDocument();
  });

  it("keeps the global Codex path out of task configuration", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Global Codex task",
      prompt: "Run with the globally configured Codex binary.",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(
      screen.queryByText("Codex バイナリパスをカスタマイズ"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Codex バイナリパス"),
    ).not.toBeInTheDocument();

    const dto = buildTaskDto(draft, false);
    expect(dto.codex).not.toHaveProperty("codexPath");
    expect(dto).not.toHaveProperty("policies");
    expect(dto.codex).not.toHaveProperty("sandboxMode");
    expect(dto.codex).not.toHaveProperty("approvalPolicy");
    expect(dto.prompt).not.toHaveProperty("injectSchedulerInstructions");

    for (const removedLabel of [
      "サンドボックス",
      "承認ポリシー",
      "最大実行時間",
      "再試行",
      "重複",
      "未実行分",
      "クリーンアップ",
      "schedule CLI を許可",
      "1実行あたりの作成スケジュール上限",
    ]) {
      expect(screen.queryByLabelText(removedLabel)).not.toBeInTheDocument();
    }
  });

  it("uses frontier model and thought-level selects", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Frontier task",
      prompt: "Use the default frontier Codex model.",
    };

    renderWithClient(<TaskWizard initialDraft={draft} />);

    expect(screen.getByRole("combobox", { name: "モデル" })).toHaveTextContent(
      "GPT-5.5",
    );
    expect(
      screen.getByRole("combobox", { name: "思考レベル" }),
    ).toHaveTextContent("中");
    expect(screen.queryByDisplayValue("gpt-5-codex")).not.toBeInTheDocument();

    expect(codexModelOptions.map((model) => model.value)).toContain(
      "gpt-5.3-codex-spark",
    );
    expect(
      reasoningEffortOptionsForModel("gpt-5.3-codex-spark").map(
        (effort) => effort.value,
      ),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(defaultReasoningEffortForModel("gpt-5.3-codex-spark")).toBe("high");
  });

  it("places create actions beside the page title without a cancel action", () => {
    renderWithClient(
      <TooltipProvider>
        <TaskWizard
          pageHeader={{
            title: "新規タスク",
            description: "タスクを1画面で設定します。",
          }}
        />
      </TooltipProvider>,
    );

    const title = screen.getByRole("heading", { name: "新規タスク" });
    const header = title.parentElement?.parentElement;
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("button", {
        name: "一時停止で作成",
      }),
    ).toBeInTheDocument();
    expect(
      within(header as HTMLElement).getByRole("button", {
        name: "タスクを作成",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "キャンセル" }),
    ).not.toBeInTheDocument();
  });

  it("normalizes deprecated Codex model values when editing a task", () => {
    const sourceDraft = {
      ...defaultTaskDraft(),
      name: "Legacy model",
      prompt: "Normalize deprecated model values.",
    };
    const task = buildTaskDto(sourceDraft, false);
    task.codex.model = "gpt-5-codex";
    task.codex.reasoningEffort = "default";

    const draft = taskToDraft(task);

    expect(draft.model).toBe(defaultCodexModel);
    expect(draft.reasoningEffort).toBe(defaultReasoningEffort);
  });

  it("disables create actions until all required fields are valid", async () => {
    const user = userEvent.setup();

    renderWithClient(<TaskWizard />);

    const createButton = screen.getByRole("button", {
      name: "タスクを作成",
    });
    const pausedButton = screen.getByRole("button", {
      name: "一時停止で作成",
    });
    const taskName = screen.getByLabelText("タスク名");
    const prompt = screen.getByLabelText("プロンプト");

    expect(createButton).toBeDisabled();
    expect(pausedButton).toBeDisabled();
    expect(taskName).toBeRequired();
    expect(prompt).toBeRequired();
    expect(
      screen.getByRole("combobox", { name: "スケジュール" }),
    ).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("combobox", { name: "モデル" })).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: "思考レベル" }),
    ).toHaveAttribute("aria-required", "true");

    await user.type(taskName, "Daily review");
    expect(createButton).toBeDisabled();

    await user.type(prompt, "Review the repository.");
    expect(createButton).toBeEnabled();
    expect(pausedButton).toBeEnabled();

    await user.clear(prompt);
    expect(createButton).toBeDisabled();
    expect(pausedButton).toBeDisabled();
  });

  it("validates every required task field through the shared schema", () => {
    const validDraft = {
      ...defaultTaskDraft(),
      name: "Daily review",
      prompt: "Review the repository.",
    };

    expect(validateTaskDraft({ ...validDraft, name: " " }).name).toBeDefined();
    expect(
      validateTaskDraft({ ...validDraft, scheduleMode: "" as never })
        .scheduleMode,
    ).toBeDefined();
    expect(
      validateTaskDraft({ ...validDraft, model: "" as never }).model,
    ).toBeDefined();
    expect(
      validateTaskDraft({ ...validDraft, reasoningEffort: "" as never })
        .reasoningEffort,
    ).toBeDefined();
    expect(
      validateTaskDraft({ ...validDraft, prompt: " " }).prompt,
    ).toBeDefined();
    expect(
      validateTaskDraft({
        ...validDraft,
        scheduleMode: "preset",
        presetMode: "daily",
        presetTime: "",
      }).presetTime,
    ).toBeDefined();
  });

  it("submits the existing task DTO shape through the create mutation", async () => {
    const user = userEvent.setup();
    const repoPath = "/Users/alice/src/my-app";
    const timestamp = "2026-07-10T00:00:00.000Z";
    vi.spyOn(ipcClient, "projectList").mockResolvedValue([
      {
        id: "proj_demo",
        name: "my-app",
        path: repoPath,
        kind: "git",
        gitRoot: repoPath,
        defaultBranch: "main",
        trustedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    const draft = {
      ...defaultTaskDraft(),
      name: "Daily review",
      prompt: "Review the repository and report the riskiest changes.",
      targetMode: "repo-worktree" as const,
      projectId: "proj_demo",
      repoPath,
      baseRef: "main",
      scheduleMode: "preset" as const,
      presetMode: "daily" as const,
      presetTime: "09:00",
      timezone: "UTC",
    };
    const expectedDto = buildTaskDto(
      { ...draft, timezone: getSystemTimezone() },
      false,
    );
    const createSpy = vi.spyOn(ipcClient, "taskCreate").mockResolvedValue({
      ...expectedDto,
      id: "task_created",
    });

    renderWithClient(<TaskWizard initialDraft={draft} />);

    const createButton = screen.getByRole("button", {
      name: "タスクを作成",
    });
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

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

  it("shows success feedback after saving task settings", async () => {
    const user = userEvent.setup();
    const draft = {
      ...defaultTaskDraft(),
      id: "task_edit",
      slug: "task-edit",
      name: "Edit callback",
      prompt: "Save this task and confirm the result.",
    };
    const existingTask = buildTaskDto(draft, false);
    const updateSpy = vi
      .spyOn(ipcClient, "taskUpdate")
      .mockResolvedValue(existingTask);
    const toastSpy = vi.spyOn(toast, "success");

    renderWithClient(<TaskWizard task={existingTask} />);
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith("変更を保存しました");
  });
});
