import { describe, expect, it } from "vitest";

import { parseRunTranscript } from "@/lib/run-transcript";

describe("parseRunTranscript", () => {
  it("merges started and completed tool events while preserving chronology", () => {
    const input = [
      { type: "thread.started", thread_id: "thread_1" },
      {
        type: "item.started",
        item: {
          id: "command_1",
          type: "command_execution",
          command: "pnpm test",
          status: "in_progress",
          aggregated_output: "",
          exit_code: null,
        },
      },
      {
        type: "item.completed",
        item: {
          id: "command_1",
          type: "command_execution",
          command: "pnpm test",
          status: "completed",
          aggregated_output: "12 tests passed",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: { id: "message_1", type: "agent_message", text: "完了しました。" },
      },
      { type: "turn.completed" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    expect(parseRunTranscript(input)).toEqual([
      {
        kind: "tool",
        id: "command_1",
        itemType: "command_execution",
        label: "コマンド",
        summary: "pnpm test",
        status: "completed",
        details: [
          { label: "コマンド", value: "pnpm test" },
          { label: "出力", value: "12 tests passed" },
          { label: "終了コード", value: "0" },
        ],
      },
      { kind: "assistant", id: "message_1", text: "完了しました。" },
    ]);
  });

  it("marks non-zero command exits as failed", () => {
    const input = JSON.stringify({
      type: "item.completed",
      item: {
        id: "command_failed",
        type: "command_execution",
        command: "pnpm test",
        status: "failed",
        aggregated_output: "test failed",
        exit_code: 1,
      },
    });

    expect(parseRunTranscript(input)[0]).toMatchObject({
      kind: "tool",
      id: "command_failed",
      status: "failed",
    });
  });

  it("hides lifecycle and reasoning events but keeps errors", () => {
    const input = [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "reasoning_1", type: "reasoning", text: "private" },
      }),
      "not-json",
      JSON.stringify({
        type: "turn.failed",
        error: { message: "接続がタイムアウトしました。" },
      }),
    ].join("\n");

    expect(parseRunTranscript(input)).toEqual([
      {
        kind: "error",
        id: "error-3",
        text: "接続がタイムアウトしました。",
        details: [
          {
            label: "イベント",
            value:
              '{"type":"turn.failed","error":{"message":"接続がタイムアウトしました。"}}',
          },
        ],
      },
    ]);
  });
});
