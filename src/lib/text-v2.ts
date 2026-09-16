import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import type { LineTextOptions } from "../types.js";
import { EMOJI_PLACEHOLDER, normalizeEmojiSegments } from "./emojis.js";
import { normalizeMentionSegments, toMentionee } from "./mentions.js";

/** LINE accepts at most 100 substitution objects in one text message v2. */
export const MAX_SUBSTITUTIONS_PER_MESSAGE = 100;

/** Text message v2 reads `{` and `}` as placeholder delimiters, escaped by doubling. */
const escapePlaceholders = (text: string): string =>
  text.replaceAll("{", "{{").replaceAll("}", "}}");

/** One span of the text that LINE replaces with a mention or an emoji. */
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
 * are.
 */
export const buildTextMessage = (
  text: string,
  options: LineTextOptions = {}
): messagingApi.TextMessage | messagingApi.TextMessageV2 => {
  const quote =
    options.quoteToken === undefined ? {} : { quoteToken: options.quoteToken };

  const placeholders = toPlaceholders(text, options);

  if (placeholders.length === 0) {
    return { text, type: "text", ...quote };
  }

  if (placeholders.length > MAX_SUBSTITUTIONS_PER_MESSAGE) {
    throw new ValidationError(
      "line",
      `LINE substitutes at most ${MAX_SUBSTITUTIONS_PER_MESSAGE} mentions and emoji per message, got ${placeholders.length}`
    );
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

  return { substitution, text: encoded, type: "textV2", ...quote };
};
