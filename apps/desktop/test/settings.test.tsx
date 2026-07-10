import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import SettingsPage from "@/app/settings/page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithClient } from "./test-utils";

describe("SettingsPage", () => {
  it("shows the global Codex path only when customization is enabled", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <TooltipProvider>
        <SettingsPage />
      </TooltipProvider>,
    );

    expect(screen.queryByLabelText("全体同時実行数")).not.toBeInTheDocument();

    const customize = screen.getByRole("checkbox", {
      name: /Codex バイナリパスをカスタマイズ/,
    });
    expect(customize).not.toBeChecked();
    expect(
      screen.queryByLabelText("Codex バイナリパス"),
    ).not.toBeInTheDocument();

    await user.click(customize);

    const input = screen.getByLabelText("Codex バイナリパス");
    expect(input).toBeInTheDocument();
    await user.type(input, "/opt/homebrew/bin/codex");
    expect(input).toHaveValue("/opt/homebrew/bin/codex");

    await user.click(customize);
    expect(
      screen.queryByLabelText("Codex バイナリパス"),
    ).not.toBeInTheDocument();
  });
});
