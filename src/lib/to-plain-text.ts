/**
 * Compiled regex patterns for toPlainText.
 * Extracted to module-level to avoid recompilation on every call.
 */
const RE_HEADINGS = /^#{1,6}\s+/gm;
const RE_BOLD_ITALIC = /\*\*\*(.+?)\*\*\*/g;
const RE_BOLD = /\*\*(.+?)\*\*/g;
const RE_ITALIC_STAR = /\*(.+?)\*/g;
const RE_ITALIC_UNDER = /__(.+?)__/g;
const RE_ITALIC_UNDER_SINGLE = /_(.+?)_/g;
const RE_STRIKETHROUGH = /~~(.+?)~~/g;
const RE_INLINE_CODE = /`(.+?)`/g;
const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const RE_IMAGE = /!\[([^\]]*)\]\([^)]+\)/g;
const RE_BLOCKQUOTE = /^>\s+/gm;
const RE_UNORDERED_LIST = /^[\s]*[-*+]\s+/gm;
const RE_ORDERED_LIST = /^[\s]*\d+\.\s+/gm;
const RE_HR = /^[-*_]{3,}\s*$/gm;
const RE_EXTRA_BLANK_LINES = /\n{3,}/g;

/**
 * Convert Markdown text to plain text by stripping formatting.
 * LINE doesn't render Markdown, so this is used for outbound messages.
 */
export const toPlainText = (markdown: string): string =>
  markdown
    .replaceAll(RE_HEADINGS, "")
    .replaceAll(RE_BOLD_ITALIC, "$1")
    .replaceAll(RE_BOLD, "$1")
    .replaceAll(RE_ITALIC_STAR, "$1")
    .replaceAll(RE_ITALIC_UNDER, "$1")
    .replaceAll(RE_ITALIC_UNDER_SINGLE, "$1")
    .replaceAll(RE_STRIKETHROUGH, "$1")
    .replaceAll(RE_INLINE_CODE, "$1")
    .replaceAll(RE_CODE_BLOCK, (match) => match.replaceAll("```", "").trim())
    .replaceAll(RE_LINK, "$1")
    .replaceAll(RE_IMAGE, "$1")
    .replaceAll(RE_BLOCKQUOTE, "")
    .replaceAll(RE_UNORDERED_LIST, "")
    .replaceAll(RE_ORDERED_LIST, "")
    .replaceAll(RE_HR, "")
    .replaceAll(RE_EXTRA_BLANK_LINES, "\n\n")
    .trim();
