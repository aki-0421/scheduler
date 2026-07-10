import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "@/components/markdown-content";

describe("MarkdownContent", () => {
  it("renders CommonMark and GFM content with a safe document hierarchy", () => {
    const markdown = [
      "# 実行結果",
      "",
      "**重要**な結果と [OpenAI](https://openai.com) へのリンクです。",
      "",
      "- [x] 完了",
      "- [ ] 未完了",
      "",
      "| 項目 | 値 |",
      "| --- | --- |",
      "| tests | 48 |",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "---",
      "",
      "<script>window.markdownExecuted = true</script>",
    ].join("\n");

    render(<MarkdownContent content={markdown} />);

    expect(
      screen.getByRole("heading", { name: "実行結果", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("重要", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenAI" })).toHaveAttribute(
      "href",
      "https://openai.com",
    );
    expect(screen.getByRole("link", { name: "OpenAI" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByText("const value = 1;", { selector: "code" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(
      screen.queryByText("window.markdownExecuted = true"),
    ).not.toBeInTheDocument();
  });

  it("does not preserve unsafe link protocols", () => {
    render(<MarkdownContent content="[危険](javascript:alert(1))" />);

    const unsafeLink = screen.getByText("危険").closest("a");
    expect(unsafeLink).toHaveAttribute("href", "");
    expect(screen.queryByRole("link", { name: "危険" })).not.toBeInTheDocument();
  });

  it("preserves a single line break in model output", () => {
    const { container } = render(
      <MarkdownContent content={"1行目\n2行目"} />,
    );
    const paragraph = container.querySelector("p");

    expect(paragraph?.querySelector("br")).toBeInTheDocument();
    expect(paragraph?.textContent).toContain("1行目");
    expect(paragraph?.textContent).toContain("2行目");
  });
});
