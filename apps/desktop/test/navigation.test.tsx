import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppLink } from "@/components/app-link";
import {
  navigateToScreen,
  replaceWithScreen,
  toStaticScreenHref,
} from "@/lib/navigation";

describe("static screen navigation", () => {
  it.each([
    ["/", "/"],
    ["/projects", "/projects/"],
    ["/tasks/", "/tasks/"],
    ["/tasks?task=task_1", "/tasks/?task=task_1"],
    ["/tasks/new?sourceRun=run_1#prompt", "/tasks/new/?sourceRun=run_1#prompt"],
  ])("maps %s to its independent HTML document", (href, expected) => {
    expect(toStaticScreenHref(href)).toBe(expected);
  });

  it("rejects routes that are not part of the static screen contract", () => {
    expect(() => toStaticScreenHref("/unknown")).toThrow(
      "Unknown Clockhand screen route",
    );
    expect(() => toStaticScreenHref("https://example.com/tasks")).toThrow(
      "Unknown Clockhand screen route",
    );
  });

  it("renders a normal anchor with no Next.js RSC navigation hook", () => {
    render(<AppLink href="/tasks/new">新規タスク</AppLink>);

    expect(screen.getByRole("link", { name: "新規タスク" })).toHaveAttribute(
      "href",
      "/tasks/new/",
    );
    expect(screen.getByRole("link", { name: "新規タスク" })).toHaveAttribute(
      "data-clockhand-navigation",
      "document",
    );
  });

  it("uses full document assignment and replacement for programmatic routes", () => {
    const navigation = {
      assign: vi.fn(),
      replace: vi.fn(),
    };

    navigateToScreen("/runs?run=run_1", navigation);
    replaceWithScreen("/projects", navigation);

    expect(navigation.assign).toHaveBeenCalledWith("/runs/?run=run_1");
    expect(navigation.replace).toHaveBeenCalledWith("/projects/");
  });
});
