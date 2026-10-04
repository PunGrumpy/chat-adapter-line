import { LineFormatConverter } from "./format-converter.js";

const converter = new LineFormatConverter();

/**
 * Converts Markdown to the plain text LINE displays.
 *
 * LINE renders no Markdown, so formatting markers are dropped while code,
 * link targets, and list markers are kept. The Markdown is parsed rather than
 * stripped with patterns, so underscores, asterisks, and backslashes in
 * ordinary text, URLs, and code arrive unchanged.
 */
export const toPlainText = (markdown: string): string =>
  converter.fromMarkdown(markdown);
