import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskDetail } from "@/components/task-detail";
import type { RunDto, TaskDto } from "@/lib/types";
import { renderWithClient } from "./test-utils";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

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
    expect(screen.getByText("タスク操作")).toBeInTheDocument();
    expect(screen.getByText("変更履歴")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables inline settings until a locked task is unlocked", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <TaskDetail task={{ ...task, locked: true }} runs={[run]} />,
    );

    await user.click(screen.getByRole("tab", { name: "設定" }));

    expect(
      screen.getByText("このタスクはロックされています"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("タスク名")).toBeDisabled();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: "ロックを解除" }),
    ).not.toHaveLength(0);
  });
});
