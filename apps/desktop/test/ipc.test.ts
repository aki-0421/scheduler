import { describe, expect, it } from "vitest";

import { normalizeIpcError } from "@/lib/ipc";

describe("normalizeIpcError", () => {
  it("preserves Error instances", () => {
    const error = new Error("daemon failed");

    expect(normalizeIpcError(error, "task_create")).toBe(error);
  });

  it("turns Tauri string rejections into actionable errors", () => {
    expect(
      normalizeIpcError(
        "daemon rpc error -32603: no such column: description",
        "task_create",
      ).message,
    ).toBe("daemon rpc error -32603: no such column: description");
  });

  it("uses a command-specific fallback for unknown rejection values", () => {
    expect(normalizeIpcError(null, "task_create").message).toBe(
      "スケジューラーコマンド task_create に失敗しました。",
    );
  });
});
