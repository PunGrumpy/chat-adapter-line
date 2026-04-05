import { describe, expect, it } from "vite-plus/test";

import { toPlainText } from "../../src/lib/to-plain-text.js";

describe("toPlainText", () => {
  it("returns plain text unchanged", () => {
    expect(toPlainText("Hello world")).toBe("Hello world");
  });

  it("strips headings", () => {
    expect(toPlainText("# Heading 1")).toBe("Heading 1");
    expect(toPlainText("## Heading 2")).toBe("Heading 2");
    expect(toPlainText("###### Heading 6")).toBe("Heading 6");
  });

  it("strips bold", () => {
    expect(toPlainText("**bold text**")).toBe("bold text");
  });

  it("strips italic with asterisks", () => {
    expect(toPlainText("*italic text*")).toBe("italic text");
  });

  it("strips italic with underscores", () => {
    expect(toPlainText("_italic text_")).toBe("italic text");
    expect(toPlainText("__italic text__")).toBe("italic text");
  });

  it("strips bold-italic", () => {
    expect(toPlainText("***bold italic***")).toBe("bold italic");
  });

  it("strips strikethrough", () => {
    expect(toPlainText("~~strikethrough~~")).toBe("strikethrough");
  });

  it("strips inline code", () => {
    expect(toPlainText("`code`")).toBe("code");
  });

  it("strips code block fences", () => {
    expect(toPlainText("```\ncode block\n```")).toBe("`\ncode block\n`");
  });

  it("strips links but keeps text", () => {
    expect(toPlainText("[click here](https://example.com)")).toBe("click here");
  });

  it("strips image markdown but keeps alt text", () => {
    expect(toPlainText("![alt text](https://example.com/img.png)")).toBe(
      "!alt text"
    );
  });

  it("strips blockquotes", () => {
    expect(toPlainText("> quoted text")).toBe("quoted text");
  });

  it("strips unordered list markers", () => {
    expect(toPlainText("- item one")).toBe("item one");
    expect(toPlainText("* item two")).toBe("item two");
    expect(toPlainText("+ item three")).toBe("item three");
  });

  it("strips ordered list markers", () => {
    expect(toPlainText("1. first")).toBe("first");
    expect(toPlainText("42. answer")).toBe("answer");
  });

  it("strips horizontal rules", () => {
    expect(toPlainText("---")).toBe("");
  });

  it("collapses extra blank lines", () => {
    expect(toPlainText("line1\n\n\n\nline2")).toBe("line1\n\nline2");
  });

  it("trims leading and trailing whitespace", () => {
    expect(toPlainText("  hello  ")).toBe("hello");
  });

  it("handles multiple formatting in one string", () => {
    const input = "# Hello **world**\n\n> This is a `quote`\n\n- item";
    expect(toPlainText(input)).toBe("Hello world\n\nThis is a quote\nitem");
  });

  it("returns empty string for empty input", () => {
    expect(toPlainText("")).toBe("");
  });

  it("handles multiline code block", () => {
    const input = "```\nline1\nline2\nline3\n```";
    expect(toPlainText(input)).toBe("`\nline1\nline2\nline3\n`");
  });
});
