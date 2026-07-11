import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation")>();
  return { ...actual, replaceWithScreen: navigation.replace };
});

describe("HomePage", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
  });

  it("uses document navigation instead of a static-export server redirect", async () => {
    render(<HomePage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "プロジェクトを開いています…",
    );
    expect(
      screen.getByRole("link", { name: "自動的に移動しない場合はこちら" }),
    ).toHaveAttribute("href", "/projects/");
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/projects"),
    );
  });
});
