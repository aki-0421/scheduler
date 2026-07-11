import { screen, within } from "@testing-library/react";
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

  it("shows execution times before task names without visible status labels", async () => {
    renderWithClient(
      <AppShell>
        <div>プロジェクト一覧</div>
      </AppShell>,
    );

    const clock = await screen.findByLabelText(/^現在日時 \d{4}年/);
    expect(clock).toHaveTextContent(/\d{4}年\d{1,2}月\d{1,2}日/);
    expect(clock).toHaveTextContent(/\d{2}:\d{2}/);

    const taskLink = await screen.findByRole("link", {
      name: /毎日のリポジトリレビュー/,
    });
    const executionTime = within(taskLink).getByTitle(/^実行対象時刻/);
    const executionTimeValue = Date.parse(
      executionTime.getAttribute("datetime") ?? "",
    );
    expect(executionTime).toHaveTextContent(
      /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/,
    );
    expect(executionTime.nextElementSibling).toHaveTextContent(
      "毎日のリポジトリレビュー",
    );
    expect(executionTimeValue).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - executionTimeValue).toBeGreaterThanOrEqual(
      5 * 60 * 1000,
    );
    expect(Date.now() - executionTimeValue).toBeLessThan(6 * 60 * 1000);
    expect(within(taskLink).getByRole("img", { name: "実行中" })).toBeVisible();
    expect(taskLink).not.toHaveTextContent(/実行中|起動予定/);

    const scheduledTaskLink = await screen.findByRole("link", {
      name: /リリースノート下書き/,
    });
    const scheduledTime = within(scheduledTaskLink).getByTitle(/^起動予定時刻/);
    expect(scheduledTime).toHaveTextContent(
      /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/,
    );
    expect(scheduledTime.nextElementSibling).toHaveTextContent(
      "リリースノート下書き",
    );
    expect(
      Date.parse(scheduledTime.getAttribute("datetime") ?? ""),
    ).toBeGreaterThan(Date.now());
    expect(
      within(scheduledTaskLink).getByRole("img", { name: "起動予定" }),
    ).toBeVisible();
    expect(scheduledTaskLink).not.toHaveTextContent(/実行中|起動予定/);

    const archived = screen.getByRole("link", { name: "アーカイブ済み" });
    const projects = screen.getByRole("link", { name: "プロジェクト" });
    expect(archived.nextElementSibling).toBe(projects);
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
