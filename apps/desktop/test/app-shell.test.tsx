import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { renderWithClient } from "./test-utils";

const navigation = vi.hoisted(() => ({
  pathname: "/projects",
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

describe("AppShell", () => {
  beforeEach(() => {
    navigation.pathname = "/projects";
    navigation.search = "";
  });

  it("shows only the running count in the header", async () => {
    renderWithClient(
      <AppShell>
        <div>プロジェクト一覧</div>
      </AppShell>,
    );

    expect(await screen.findByLabelText("実行中 1件")).toBeInTheDocument();
    expect(screen.queryByLabelText(/待機中/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/キュー/)).not.toBeInTheDocument();
  });

  it("links a selected run breadcrumb back to its task", async () => {
    navigation.pathname = "/runs";
    navigation.search = "run=run_success";

    renderWithClient(
      <AppShell>
        <div>実行詳細</div>
      </AppShell>,
    );

    expect(
      await screen.findByRole("link", { name: "毎日のリポジトリレビュー" }),
    ).toHaveAttribute("href", "/tasks?task=task_daily_review");
    expect(
      screen.queryByRole("link", { name: "実行履歴" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("run_success")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
