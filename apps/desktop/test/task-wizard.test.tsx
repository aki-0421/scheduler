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

    const cronInput = screen.getByLabelText("Cron expression");
    await user.clear(cronInput);
    await user.type(cronInput, "0 0 1 1 * *");

    expect(await screen.findByText("seconds are not supported")).toBeInTheDocument();
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
    expect(preview).toHaveTextContent("Next 5 runs");
    expect(preview.querySelectorAll("span")).toHaveLength(5);
  });
});
