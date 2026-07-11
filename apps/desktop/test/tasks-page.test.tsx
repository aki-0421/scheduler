import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TasksPage from "@/app/tasks/page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithClient } from "./test-utils";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=archived"),
}));

describe("TasksPage archived table", () => {
  it("renders each archived task as one table row", async () => {
    const { container } = renderWithClient(
      <TooltipProvider>
        <TasksPage />
      </TooltipProvider>,
    );
    const table = await screen.findByRole("table");

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "タスク",
      "実行先",
      "スケジュール",
      "前回状態",
      "前回実行",
      "所要時間",
    ]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => within(row).getAllByRole("cell").length === 6),
    ).toBe(true);
    expect(
      within(table).queryByRole("link", { name: "リリースノート下書き" }),
    ).not.toBeInTheDocument();

    const dependencyScanRow = within(table).getByRole("row", {
      name: /依存関係スキャン/,
    });
    expect(
      within(dependencyScanRow).getByRole("link", {
        name: "依存関係スキャン",
      }),
    ).toHaveAttribute("href", "/tasks/?task=task_dependency_scan");
    expect(
      screen.queryByText(
        "/Users/aki-0421/conductor/workspaces/scheduler/davis-v2",
      ),
    ).not.toBeInTheDocument();
    expect(container.querySelector("dl")).not.toBeInTheDocument();
  });
});
