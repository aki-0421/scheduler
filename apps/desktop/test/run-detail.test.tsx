import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunDetail } from "@/components/run-detail";
import { ipcClient } from "@/lib/ipc";
import type { RunDto } from "@/lib/types";
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

describe("RunDetail", () => {
  it("renders stdout and stderr tail data", async () => {
    const tailSpy = vi.spyOn(ipcClient, "runTailLog").mockImplementation(async (params) => ({
      runId: params.runId,
      stream: params.stream,
      cursor: params.cursor ?? 0,
      nextCursor: 10,
      eof: true,
      data: params.stream === "stdout" ? "stdout log line\n" : "stderr log line\n",
    }));

    renderWithClient(<RunDetail run={run} />);

    expect(await screen.findByText(/stdout log line/)).toBeInTheDocument();
    expect(tailSpy).toHaveBeenCalledWith({
      runId: "run_test",
      stream: "stdout",
      cursor: 0,
      limit: 16384,
    });

    tailSpy.mockRestore();
  });
});
