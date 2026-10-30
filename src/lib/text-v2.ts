import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import type { LineTextOptions } from "../types.js";
import { EMOJI_PLACEHOLDER, normalizeEmojiSegments } from "./emojis.js";
import { normalizeMentionSegments, toMentionee } from "./mentions.js";
import { splitText } from "./split-text.js";

/**
 * LINE caps the text of a text message at 5000 characters, counted in UTF-16
 * code units, which is what `String.prototype.length` counts.
 */
export const MAX_TEXT_LENGTH = 5000;

const checkTextLength = (text: string): void => {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ValidationError(
      "line",
      `LINE accepts at most ${MAX_TEXT_LENGTH} characters in a text message, got ${text.length}`
    );
  }
};

/** Text message v2 reads `{` and `}` as placeholder delimiters, escaped by doubling. */
const escapePlaceholders = (text: string): string =>
  text.replaceAll("{", "{{").replaceAll("}", "}}");

interface Placeholder {
  index: number;
  length: number;
  key: string;
  value: messagingApi.SubstitutionObject;
}

const toPlaceholders = (
  text: string,
  options: LineTextOptions
): Placeholder[] => {
  const mentions = normalizeMentionSegments(text, options.mentions ?? []);
  const emojis = normalizeEmojiSegments(text, options.emojis ?? []);

  return [
    ...mentions.map(
      (segment, position): Placeholder => ({
        index: segment.index,
        key: `mention${position}`,
        length: segment.length,
        value: { mentionee: toMentionee(segment), type: "mention" },
      })
    ),
    ...emojis.map(
      (segment, position): Placeholder => ({
        index: segment.index,
        key: `emoji${position}`,
        length: EMOJI_PLACEHOLDER.length,
        value: {
          emojiId: segment.emojiId,
          productId: segment.productId,
          type: "emoji",
        },
      })
    ),
  ];
};

/**
 * Builds the outbound LINE text message for `text`.
 *
 * Without mentions or emoji this is a plain `text` message. Otherwise each
 * mentioned span, and each `$` standing in for a native emoji, becomes a
 * `{mentionN}` or `{emojiN}` placeholder on a `textV2` message, and LINE
 * renders the substitution in place. Mentions and emoji share one text, so
 * two of them covering the same characters are rejected whichever kind they
 * are. Either shape is rejected once the text LINE would receive passes
 * 5000 characters.
 */
export const buildTextMessage = (
  text: string,
  options: LineTextOptions = {}
): messagingApi.TextMessage | messagingApi.TextMessageV2 => {
  const quote =
    options.quoteToken === undefined ? {} : { quoteToken: options.quoteToken };

  const placeholders = toPlaceholders(text, options);

  if (placeholders.length === 0) {
    checkTextLength(text);
    return { text, type: "text", ...quote };
  }

  const substitution: Record<string, messagingApi.SubstitutionObject> = {};
  let encoded = "";
  let cursor = 0;

  for (const placeholder of placeholders.toSorted(
    (a, b) => a.index - b.index
  )) {
    if (placeholder.index < cursor) {
      throw new ValidationError(
        "line",
        `Substitutions overlap at index ${placeholder.index}`
      );
    }

    encoded += escapePlaceholders(text.slice(cursor, placeholder.index));
    encoded += `{${placeholder.key}}`;
    substitution[placeholder.key] = placeholder.value;
    cursor = placeholder.index + placeholder.length;
  }

  encoded += escapePlaceholders(text.slice(cursor));

  checkTextLength(encoded);

  return { substitution, text: encoded, type: "textV2", ...quote };
};

/**
 * Builds the outbound LINE text messages for `text`.
 *
 * Plain text over 5000 characters is split the way streamed replies are, and
 * only the first part carries the quote token. Text with mentions or emoji is
 * never split, because both are positioned by offset in one message, so it
 * still throws once it passes the limit. Text that is empty or blank throws
 * instead of reaching LINE as an empty message.
 */
export const buildTextMessages = (
  text: string,
  options: LineTextOptions = {}
): messagingApi.Message[] => {
  const hasSubstitutions =
    (options.mentions?.length ?? 0) > 0 || (options.emojis?.length ?? 0) > 0;

  if (hasSubstitutions) {
    return [buildTextMessage(text, options)];
  }

  const parts = splitText(text, MAX_TEXT_LENGTH);

  if (parts.length === 0) {
    throw new ValidationError("line", "No message content to send");
  }

  return parts.map((part, index) =>
    buildTextMessage(part, index === 0 ? options : {})
  );
};
