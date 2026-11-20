import { emoji, parseMarkdown } from "chat";
import { describe, expect, it } from "vite-plus/test";

import { LineFormatConverter } from "../../src/lib/format-converter.js";
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

  it("strips inline code markers", () => {
    expect(toPlainText("`code`")).toBe("code");
  });

  it("keeps code block content without its fences", () => {
    expect(toPlainText("```\ncode block\n```")).toBe("code block");
  });

  it("keeps a link's URL after its text", () => {
    expect(toPlainText("[click here](https://example.com)")).toBe(
      "click here (https://example.com)"
    );
  });

  it("keeps an image's URL after its alt text", () => {
    expect(toPlainText("![alt text](https://example.com/img.png)")).toBe(
      "alt text (https://example.com/img.png)"
    );
    expect(toPlainText("![](https://example.com/img.png)")).toBe(
      "https://example.com/img.png"
    );
  });

  it("strips blockquote markers", () => {
    expect(toPlainText("> quoted text")).toBe("quoted text");
  });

  it("keeps unordered list markers as dashes", () => {
    expect(toPlainText("- item one")).toBe("- item one");
    expect(toPlainText("* item two")).toBe("- item two");
    expect(toPlainText("+ item three")).toBe("- item three");
  });

  it("keeps ordered list numbers", () => {
    expect(toPlainText("1. first")).toBe("1. first");
    expect(toPlainText("42. answer")).toBe("42. answer");
    expect(toPlainText("1. Install\n2. Configure\n3. Deploy")).toBe(
      "1. Install\n2. Configure\n3. Deploy"
    );
  });

  it("indents nested lists", () => {
    expect(toPlainText("- a\n  - b\n- c")).toBe("- a\n  - b\n- c");
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
    expect(toPlainText(input)).toBe("Hello world\n\nThis is a quote\n\n- item");
  });

  it("returns empty string for empty input", () => {
    expect(toPlainText("")).toBe("");
  });

  it("handles multiline code block", () => {
    const input = "```\nline1\nline2\nline3\n```";
    expect(toPlainText(input)).toBe("line1\nline2\nline3");
  });

  it("keeps underscores in words, file names, and URLs", () => {
    expect(toPlainText("Rename snake_case_name in my_file.py")).toBe(
      "Rename snake_case_name in my_file.py"
    );
    expect(
      toPlainText(
        "Book: https://shop.example.com/promo?utm_source=line&utm_medium=bot"
      )
    ).toBe(
      "Book: https://shop.example.com/promo?utm_source=line&utm_medium=bot"
    );
    expect(toPlainText("<https://example.com/a_b>")).toBe(
      "https://example.com/a_b"
    );
  });

  it("keeps asterisks that are not emphasis", () => {
    expect(toPlainText("Compute 2 * 3 * 4 = 24")).toBe(
      "Compute 2 * 3 * 4 = 24"
    );
    expect(toPlainText("Works on *nix")).toBe("Works on *nix");
  });

  it("keeps code exactly as written", () => {
    expect(
      toPlainText(
        "```python\ndef get_user_id(user_obj):\n    return user_obj.user_id * 2\n```"
      )
    ).toBe("def get_user_id(user_obj):\n    return user_obj.user_id * 2");
    expect(toPlainText("run `git push --force_with_lease`")).toBe(
      "run git push --force_with_lease"
    );
  });

  it("never adds escape backslashes", () => {
    expect(toPlainText("#hashtag")).toBe("#hashtag");
    expect(toPlainText("Price $5 [approx]")).toBe("Price $5 [approx]");
    expect(toPlainText("Use {name} and $ signs")).toBe(
      "Use {name} and $ signs"
    );
  });

  it("turns a hard line break into a newline", () => {
    expect(toPlainText("Name: Alice  \nRole: Admin")).toBe(
      "Name: Alice\nRole: Admin"
    );
  });

  it("shows a bare or autolinked URL once", () => {
    expect(toPlainText("[https://example.com](https://example.com)")).toBe(
      "https://example.com"
    );
    expect(toPlainText("<team@example.com>")).toBe("team@example.com");
    expect(toPlainText("Visit www.example.com today")).toBe(
      "Visit www.example.com today"
    );
  });

  it("keeps a reference link's definition", () => {
    expect(toPlainText("See [docs][1].\n\n[1]: https://example.com/docs")).toBe(
      "See docs.\n\n[1]: https://example.com/docs"
    );
  });

  it("renders a table as text", () => {
    expect(toPlainText("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "a | b\n--|--\n1 | 2"
    );
  });

  it("keeps link URLs inside table cells", () => {
    expect(
      toPlainText(
        "| Item | Link |\n| --- | --- |\n| Docs | [open](https://example.com/docs) |"
      )
    ).toBe(
      "Item | Link\n-----|--------------------------------\nDocs | open (https://example.com/docs)"
    );
  });

  it("renders inline code and emphasis inside table cells", () => {
    expect(
      toPlainText("| Code | Style |\n| --- | --- |\n| `foo` | **bold** |")
    ).toBe("Code | Style\n-----|------\nfoo  | bold");
  });

  it("keeps unordered task-list checkboxes", () => {
    expect(toPlainText("- [x] done\n- [ ] todo")).toBe(
      "- [x] done\n- [ ] todo"
    );
  });

  it("keeps ordered task-list checkboxes", () => {
    expect(toPlainText("1. [x] one\n2. [ ] two")).toBe(
      "1. [x] one\n2. [ ] two"
    );
  });

  it("keeps nested task-list checkboxes", () => {
    expect(toPlainText("- [ ] parent\n  - [x] child\n  - plain")).toBe(
      "- [ ] parent\n  - [x] child\n  - plain"
    );
  });

  it("keeps footnote markers and definitions", () => {
    expect(toPlainText("Fact[^1].\n\n[^1]: Source text.")).toBe(
      "Fact[1].\n\n[1]: Source text."
    );
  });

  it("keeps image-reference alt text and its definition", () => {
    expect(
      toPlainText("![logo][img]\n\n[img]: https://example.com/a.png")
    ).toBe("logo\n\n[img]: https://example.com/a.png");
  });

  it("renders a task-list AST twice without mutating it", () => {
    const ast = parseMarkdown("- [ ] parent\n  - [x] child\n  - plain");
    const original = structuredClone(ast);
    const converter = new LineFormatConverter();

    const first = converter.fromAst(ast);
    const second = converter.fromAst(ast);

    expect(first).toBe("- [ ] parent\n  - [x] child\n  - plain");
    expect(second).toBe(first);
    expect(ast).toEqual(original);
  });

  it("keeps inline HTML as written", () => {
    expect(toPlainText("<b>hi</b> there")).toBe("<b>hi</b> there");
  });

  it("renders the Chat SDK's emoji placeholders as Unicode emoji", () => {
    expect(toPlainText(`${emoji.fire} hot`)).toBe("🔥 hot");
    expect(toPlainText(`**${emoji.wave}** hi`)).toBe("👋 hi");
  });
});
