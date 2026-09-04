import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import type {
  LineMention,
  LineMentionSegment,
  LineMessageEvent,
  LineTextOptions,
} from "../types.js";
import { isRecord } from "./is-record.js";

/**
 * Reads LINE's `mention.mentionees` array off an inbound text message.
 * Entries that do not carry a usable index and length are dropped.
 */
export const parseInboundMentions = (
  message: LineMessageEvent["message"]
): LineMention[] => {
  const mentionees: unknown = message.mention?.mentionees;
  if (!Array.isArray(mentionees)) {
    return [];
  }

  const mentions: LineMention[] = [];

  for (const entry of mentionees) {
    if (
      !isRecord(entry) ||
      typeof entry.index !== "number" ||
      typeof entry.length !== "number"
    ) {
      continue;
    }

    if (entry.type === "all") {
      mentions.push({ index: entry.index, length: entry.length, type: "all" });
      continue;
    }

    if (entry.type !== "user") {
      continue;
    }

    const mention: LineMention = {
      index: entry.index,
      length: entry.length,
      type: "user",
    };
    if (typeof entry.userId === "string") {
      mention.userId = entry.userId;
    }
    if (typeof entry.isSelf === "boolean") {
      mention.isSelf = entry.isSelf;
    }
    mentions.push(mention);
  }

  return mentions;
};

/** LINE substitutes at most 20 mentions in one text message v2. */
export const MAX_MENTIONS_PER_MESSAGE = 20;

/** Text message v2 reads `{` and `}` as placeholder delimiters, escaped by doubling. */
const escapePlaceholders = (text: string): string =>
  text.replaceAll("{", "{{").replaceAll("}", "}}");

const validateSegment = (
  segment: LineMentionSegment,
  textLength: number
): void => {
  if (!Number.isInteger(segment.index) || segment.index < 0) {
    throw new ValidationError(
      "line",
      `Mention index must be a non-negative integer, got ${String(segment.index)}`
    );
  }
  if (!Number.isInteger(segment.length) || segment.length <= 0) {
    throw new ValidationError(
      "line",
      `Mention length must be a positive integer, got ${String(segment.length)}`
    );
  }
  if (segment.index + segment.length > textLength) {
    throw new ValidationError(
      "line",
      `Mention at index ${segment.index} with length ${segment.length} exceeds the text length of ${textLength}`
    );
  }

  const hasUserId =
    typeof segment.userId === "string" && segment.userId.length > 0;
  const hasAll = segment.all === true;

  if (hasUserId === hasAll) {
    throw new ValidationError(
      "line",
      "Each mention must set exactly one of `userId` or `all: true`"
    );
  }
};

/**
 * Validates mention segments against the text and returns them sorted by
 * index. Overlapping segments are rejected because LINE cannot render two
 * mentions over the same characters.
 */
const normalizeSegments = (
  text: string,
  segments: LineMentionSegment[]
): LineMentionSegment[] => {
  if (segments.length > MAX_MENTIONS_PER_MESSAGE) {
    throw new ValidationError(
      "line",
      `LINE substitutes at most ${MAX_MENTIONS_PER_MESSAGE} mentions per message, got ${segments.length}`
    );
  }

  for (const segment of segments) {
    validateSegment(segment, text.length);
  }

  const sorted = segments.toSorted((a, b) => a.index - b.index);

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.index < previous.index + previous.length) {
      throw new ValidationError(
        "line",
        `Mentions overlap at index ${current.index}`
      );
    }
  }

  return sorted;
};

const toMentionee = (segment: LineMentionSegment): messagingApi.MentionTarget =>
  segment.all === true
    ? { type: "all" }
    : { type: "user", userId: segment.userId as string };

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

  const segments = normalizeSegments(text, options.mentions);
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
