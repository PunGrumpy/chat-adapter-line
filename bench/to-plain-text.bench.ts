import { bench, describe } from "vite-plus/test";

import { toPlainText } from "../src/lib/to-plain-text.js";

const SMALL_MARKDOWN = [
  "# Hello from LINE",
  "",
  "This has **bold**, _italic_, and `inline code`.",
  "",
  "- item one",
  "- item two",
  "",
  "[docs](https://example.com)",
].join("\n");

const MEDIUM_MARKDOWN_SECTION = [
  "## Release Notes",
  "",
  "1. Added **thread parsing** improvements.",
  "2. Improved _markdown_ conversion quality.",
  "3. Visit [changelog](https://example.com/changelog).",
  "",
  "> This quoted section should become plain text.",
  "",
  "```ts",
  "const value = 'benchmark';",
  "console.log(value);",
  "```",
].join("\n");

const MEDIUM_MARKDOWN = Array.from(
  { length: 20 },
  () => MEDIUM_MARKDOWN_SECTION
)
  .join("\n\n")
  .trim();

const LARGE_MARKDOWN = Array.from({ length: 120 }, (_, index) => {
  const item = index + 1;
  return [
    `### Event ${item}`,
    "",
    `Message with **bold ${item}** and _italic ${item}_ plus [link](https://example.com/${item}).`,
    "",
    `- bullet ${item}`,
    `- bullet ${item + 1}`,
    "",
    "> Blockquote content for load testing.",
  ].join("\n");
})
  .join("\n\n")
  .trim();

describe("toPlainText", () => {
  bench("small markdown payload", () => {
    toPlainText(SMALL_MARKDOWN);
  });

  bench("medium markdown payload", () => {
    toPlainText(MEDIUM_MARKDOWN);
  });

  bench("large markdown payload", () => {
    toPlainText(LARGE_MARKDOWN);
  });
});
