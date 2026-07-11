import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TaskDetail } from "@/components/task-detail";
import type { RunDto, TaskDto } from "@/lib/types";
import { renderWithClient } from "./test-utils";

const task: TaskDto = {
  id: "task_test",
  slug: "task-test",
  name: "毎日のレビュー",
  status: "active",
  locked: false,
  kind: "cron",
  cronExpr: "0 9 * * 1-5",
  timezone: "UTC",
  nextRunAt: "2026-07-11T09:00:00.000Z",
  target: { mode: "chat" },
  codex: {
    model: "gpt-5.5",
    reasoningEffort: "medium",
  },
  prompt: {
    body: "変更内容をレビューしてください。",
  },
};

const run: RunDto = {
  id: "run_test",
  taskId: task.id,
  triggerType: "schedule",
  scheduledFor: "2026-07-10T09:00:00.000Z",
  status: "succeeded",
  durationMs: 60_000,
  resultSummary: "問題は見つかりませんでした。",
  findingsCount: 0,
  createdScheduleCount: 0,
  artifacts: [],
};

describe("TaskDetail", () => {
  it("shows only run history and settings with run history selected first", () => {
    renderWithClient(<TaskDetail task={task} runs={[run]} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["実行履歴", "設定"]);
    expect(screen.getByRole("tab", { name: "実行履歴" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("問題は見つかりませんでした。"),
    ).toBeInTheDocument();
    const history = screen.getByRole("tabpanel", { name: "実行履歴" });
    expect(within(history).getAllByText("状態")).not.toHaveLength(0);
    expect(within(history).getByText("予定時刻")).toBeInTheDocument();
    expect(within(history).getByText("所要時間")).toBeInTheDocument();
    expect(within(history).getByText("結果")).toBeInTheDocument();
    expect(within(history).queryByText(task.id)).not.toBeInTheDocument();
    expect(within(history).queryByText("スケジュール")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "概要" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "プロンプト" }),
    ).not.toBeInTheDocument();
  });

  it("reuses the task creation form inline in settings", async () => {
    const user = userEvent.setup();
    renderWithClient(<TaskDetail task={task} runs={[run]} />);

    await user.click(screen.getByRole("tab", { name: "設定" }));

    expect(screen.getByLabelText("タスク名")).toHaveValue("毎日のレビュー");
    expect(screen.getByLabelText("プロンプト")).toHaveValue(
      "変更内容をレビューしてください。",
    );
    expect(
      screen.getByRole("button", { name: "変更を保存" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "キャンセル" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("タスク操作")).not.toBeInTheDocument();
    expect(screen.queryByText("変更履歴")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps inline settings editable for locked tasks", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <TaskDetail task={{ ...task, locked: true }} runs={[run]} />,
    );

    await user.click(screen.getByRole("tab", { name: "設定" }));

    expect(
      screen.queryByText("このタスクはロックされています"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("タスク名")).toBeEnabled();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "タスクをロック" })).toBeChecked();
    expect(
      screen.getByText("AIエージェントやCLIからの変更・停止・削除を防ぎます。"),
    ).toBeInTheDocument();
  });
});
