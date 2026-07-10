import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunDetail } from "@/components/run-detail";
import { ipcClient } from "@/lib/ipc";
import type { RunDto, TaskDto } from "@/lib/types";
import { renderWithClient } from "./test-utils";

const run: RunDto = {
  id: "run_test",
  taskId: "task_test",
  triggerType: "manual",
  scheduledFor: "2026-07-08T00:00:00Z",
  status: "succeeded",
  startedAt: "2026-07-08T00:00:10Z",
  endedAt: "2026-07-08T00:00:20Z",
  exitCode: 0,
  resultSummary: "Done.",
  findingsCount: 0,
  createdScheduleCount: 0,
};

const task: TaskDto = {
  id: "task_test",
  slug: "test-task",
  name: "テストタスク",
  status: "active",
  locked: false,
  kind: "manual",
  timezone: "Asia/Tokyo",
  target: { mode: "chat" },
  codex: {},
  prompt: { body: "Repository status を確認してください。" },
};

function eventTail(runId: string) {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "thread_test" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.started",
      item: {
        id: "command_1",
        type: "command_execution",
        command: `git status --short ${runId}`,
        status: "in_progress",
        aggregated_output: "",
        exit_code: null,
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: `git status --short ${runId}`,
        status: "completed",
        aggregated_output: "clean working tree",
        exit_code: 0,
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "message_1", type: "agent_message", text: "Done." },
    }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");
}

describe("RunDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a chat-only transcript with compact, collapsed tool details", async () => {
    const user = userEvent.setup();
    const tailSpy = vi
      .spyOn(ipcClient, "runTailLog")
      .mockImplementation(async (params) => ({
        runId: params.runId,
        stream: params.stream,
        cursor: params.cursor ?? 0,
        nextCursor: eventTail(params.runId).length,
        eof: true,
        data: eventTail(params.runId),
      }));

    renderWithClient(<RunDetail run={run} task={task} />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("システムプロンプト")).toBeInTheDocument();
    expect(
      screen.getByText("Repository status を確認してください。"),
    ).toBeInTheDocument();

    const commandSummary = await screen.findByText(
      "git status --short run_test",
      { selector: "span" },
    );
    const disclosure = commandSummary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getAllByText("コマンド", { selector: "span" })).toHaveLength(1);
    expect(screen.getAllByText("Done.")).toHaveLength(1);

    await user.click(disclosure!.querySelector("summary")!);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("clean working tree")).toBeInTheDocument();

    expect(tailSpy).toHaveBeenCalledWith({
      runId: "run_test",
      stream: "events",
      cursor: 0,
      limit: 16_384,
    });
    expect(tailSpy).toHaveBeenCalledTimes(1);
  });

  it("does not expose lifecycle events or raw log tabs", async () => {
    vi.spyOn(ipcClient, "runTailLog").mockImplementation(async (params) => ({
      runId: params.runId,
      stream: params.stream,
      cursor: params.cursor ?? 0,
      nextCursor: eventTail(params.runId).length,
      eof: true,
      data: eventTail(params.runId),
    }));

    renderWithClient(<RunDetail run={run} task={task} />);

    await screen.findByText("git status --short run_test", {
      selector: "span",
    });
    expect(screen.queryByText("thread.started")).not.toBeInTheDocument();
    expect(screen.queryByText("turn.started")).not.toBeInTheDocument();
    expect(screen.queryByText("stdout")).not.toBeInTheDocument();
    expect(screen.queryByText("stderr")).not.toBeInTheDocument();
    expect(screen.queryByText("成果物")).not.toBeInTheDocument();
  });

  it("resets the transcript when switching runs", async () => {
    vi.spyOn(ipcClient, "runTailLog").mockImplementation(async (params) => ({
      runId: params.runId,
      stream: params.stream,
      cursor: params.cursor ?? 0,
      nextCursor: eventTail(params.runId).length,
      eof: true,
      data: eventTail(params.runId),
    }));

    const { rerender } = renderWithClient(<RunDetail run={run} task={task} />);

    expect(
      await screen.findByText("git status --short run_test", {
        selector: "span",
      }),
    ).toBeInTheDocument();

    rerender(<RunDetail run={{ ...run, id: "run_next" }} task={task} />);

    await waitFor(() =>
      expect(
        screen.queryByText("git status --short run_test", {
          selector: "span",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText("git status --short run_next", {
        selector: "span",
      }),
    ).toBeInTheDocument();
  });

  it("manually queues a new run from a completed session", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcClient, "runTailLog").mockResolvedValue({
      runId: "run_test",
      stream: "events",
      cursor: 0,
      nextCursor: 0,
      eof: true,
      data: "",
    });
    const runNow = vi.spyOn(ipcClient, "taskRunNow").mockResolvedValue({
      id: "run_retry_manual",
      taskId: "task_test",
      triggerType: "manual",
      status: "queued",
      findingsCount: 0,
      createdScheduleCount: 0,
      artifacts: [],
    });

    renderWithClient(<RunDetail run={{ ...run, status: "failed" }} task={task} />);
    await user.click(screen.getByRole("button", { name: "再実行" }));

    await waitFor(() => expect(runNow).toHaveBeenCalledWith("task_test"));
  });

  it("shows cancel instead of retry while a run is active", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcClient, "runTailLog").mockResolvedValue({
      runId: "run_test",
      stream: "events",
      cursor: 0,
      nextCursor: 0,
      eof: true,
      data: "",
    });
    const cancel = vi
      .spyOn(ipcClient, "runCancel")
      .mockResolvedValue({ ...run, status: "canceled" });

    renderWithClient(<RunDetail run={{ ...run, status: "running" }} task={task} />);

    expect(screen.queryByRole("button", { name: "再実行" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("run_test"));
  });
});
