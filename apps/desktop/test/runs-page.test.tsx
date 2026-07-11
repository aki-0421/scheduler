import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RunsPage from "@/app/runs/page";
import { renderWithClient } from "./test-utils";

const navigation = vi.hoisted(() => ({
  search: "run=run_success",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

describe("RunsPage", () => {
  beforeEach(() => {
    navigation.search = "run=run_success";
    navigation.replace.mockReset();
  });

  it("renders only the selected chat session instead of the history controls and rows", async () => {
    renderWithClient(<RunsPage />);

    expect(
      await screen.findByRole("heading", { name: "毎日のリポジトリレビュー" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("最終出力")).toBeInTheDocument();
    expect(screen.queryByText("最終出力")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "タスク情報" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "タスクプロンプト" }),
    ).toBeInTheDocument();

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("システムプロンプト")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最近" })).not.toBeInTheDocument();
    expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
  });

  it("redirects the removed global history route to projects", async () => {
    navigation.search = "";

    renderWithClient(<RunsPage />);

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/projects"),
    );
    expect(
      screen.queryByRole("heading", { name: "実行履歴" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
