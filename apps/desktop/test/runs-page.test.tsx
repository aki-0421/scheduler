import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RunsPage from "@/app/runs/page";
import { renderWithClient } from "./test-utils";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=run_success"),
}));

describe("RunsPage selected session", () => {
  it("renders only the selected chat session instead of the history controls and rows", async () => {
    renderWithClient(<RunsPage />);

    expect(
      await screen.findByRole("heading", { name: "毎日のリポジトリレビュー" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("システムプロンプト")).toBeInTheDocument();
    expect(await screen.findByText("最終出力")).toBeInTheDocument();

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最近" })).not.toBeInTheDocument();
    expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
  });
});
