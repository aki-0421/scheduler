import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
  });

  it("resets rendered log state when switching runs", async () => {
    vi.spyOn(ipcClient, "runTailLog").mockImplementation(async (params) => ({
      runId: params.runId,
      stream: params.stream,
      cursor: params.cursor ?? 0,
      nextCursor: 10,
      eof: true,
      data:
        params.stream === "stdout"
          ? `${params.runId === "run_test" ? "first" : "second"} run log\n`
          : "",
    }));

    const { rerender } = renderWithClient(<RunDetail run={run} />);

    expect(await screen.findByText(/first run log/)).toBeInTheDocument();

    rerender(<RunDetail run={{ ...run, id: "run_next" }} />);

    await waitFor(() =>
      expect(screen.queryByText(/first run log/)).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/second run log/)).toBeInTheDocument();
  });
});
