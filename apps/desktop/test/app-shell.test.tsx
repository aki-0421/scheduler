import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { renderWithClient } from "./test-utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));

describe("AppShell", () => {
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
});
