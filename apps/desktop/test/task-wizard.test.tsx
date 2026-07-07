import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TaskWizard } from "@/components/task-wizard";
import { defaultTaskDraft } from "@/lib/task-draft";
import { renderWithClient } from "./test-utils";

describe("TaskWizard cron validation", () => {
  it("shows a 6-field cron error inline", async () => {
    const user = userEvent.setup();
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "0 9 * * 1-5",
    };

    renderWithClient(<TaskWizard initialDraft={draft} initialStep={2} />);

    const cronInput = screen.getByLabelText("Cron 式");
    await user.clear(cronInput);
    await user.type(cronInput, "0 0 1 1 * *");

    expect(
      await screen.findByText("秒 field はサポートしていません。5-field cron を使ってください。"),
    ).toBeInTheDocument();
  });

  it("renders the next five cron preview entries", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Cron task",
      prompt: "Run a cron task.",
      scheduleMode: "cron" as const,
      cronExpr: "*/15 * * * *",
    };

    renderWithClient(<TaskWizard initialDraft={draft} initialStep={2} />);

    const preview = screen.getByTestId("cron-preview");
    expect(preview).toHaveTextContent("次の 5 回");
    expect(preview.querySelectorAll("span")).toHaveLength(5);
  });

  it("shows hardening warnings on review", () => {
    const draft = {
      ...defaultTaskDraft(),
      name: "Danger task",
      prompt: "Run with broad permissions.",
      targetMode: "repo-local" as const,
      repoPath: "/tmp/repo",
      sandboxMode: "danger-full-access" as const,
      allowScheduleCli: true,
      capabilities: ["schedule:create", "schedule:update-any"],
    };

    renderWithClient(<TaskWizard initialDraft={draft} initialStep={5} />);

    expect(
      screen.getByLabelText("danger-full-access のリスクを理解しました"),
    ).toBeInTheDocument();
    expect(screen.getByText("schedule:update-any")).toBeInTheDocument();
    expect(screen.getByText("未信頼のリポジトリ")).toBeInTheDocument();
  });
});
