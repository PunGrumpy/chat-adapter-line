import type { messagingApi } from "@line/bot-sdk";

import type { LineTextOptions } from "../types.js";
import { normalizeMentionSegments, toMentionee } from "./mentions.js";

/** Text message v2 reads `{` and `}` as placeholder delimiters, escaped by doubling. */
const escapePlaceholders = (text: string): string =>
  text.replaceAll("{", "{{").replaceAll("}", "}}");

/**
 * Builds the outbound LINE text message for `text`.
 *
 * Without mentions this is a plain `text` message. With mentions, the
 * mentioned spans become `{mentionN}` placeholders on a `textV2` message and
 * LINE renders each one as a native mention.
 */
export const buildTextMessage = (
  text: string,
  options: LineTextOptions = {}
): messagingApi.TextMessage | messagingApi.TextMessageV2 => {
  const quote =
    options.quoteToken === undefined ? {} : { quoteToken: options.quoteToken };

  if (!options.mentions || options.mentions.length === 0) {
    return { text, type: "text", ...quote };
  }

  const segments = normalizeMentionSegments(text, options.mentions);
  const substitution: Record<string, messagingApi.SubstitutionObject> = {};
  let encoded = "";
  let cursor = 0;

  for (const [position, segment] of segments.entries()) {
    const key = `mention${position}`;
    encoded += escapePlaceholders(text.slice(cursor, segment.index));
    encoded += `{${key}}`;
    substitution[key] = { mentionee: toMentionee(segment), type: "mention" };
    cursor = segment.index + segment.length;
  }

  encoded += escapePlaceholders(text.slice(cursor));

  return { substitution, text: encoded, type: "textV2", ...quote };
};
