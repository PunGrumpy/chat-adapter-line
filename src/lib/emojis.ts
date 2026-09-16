import { ValidationError } from "@chat-adapter/shared";

import type {
  LineEmoji,
  LineEmojiSegment,
  LineMessageEvent,
} from "../types.js";
import { isNonEmptyString, isNonNegativeInteger } from "./guards.js";
import { isRecord } from "./is-record.js";

/** LINE stands one native emoji in for a single `$` in the text it sends. */
export const EMOJI_PLACEHOLDER = "$";

/**
 * Reads LINE's `emojis` array off an inbound text message.
 *
 * Entries without a usable identifier pair are dropped, as are those whose
 * span runs past the text, so one malformed entry never costs the caller the
 * rest of the message and no entry points at characters that are not there.
 * The text itself is left alone, native emoji sequences and all.
 */
export const parseInboundEmojis = (
  message: LineMessageEvent["message"]
): LineEmoji[] => {
  const entries: unknown = message.emojis;
  if (!Array.isArray(entries)) {
    return [];
  }

  const text = message.text ?? "";
  const emojis: LineEmoji[] = [];

  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      !isNonNegativeInteger(entry.index) ||
      !isNonNegativeInteger(entry.length) ||
      entry.length === 0 ||
      entry.index + entry.length > text.length ||
      !isNonEmptyString(entry.productId) ||
      !isNonEmptyString(entry.emojiId)
    ) {
      continue;
    }

    emojis.push({
      emojiId: entry.emojiId,
      index: entry.index,
      length: entry.length,
      productId: entry.productId,
    });
  }

  return emojis;
};

const validateSegment = (segment: LineEmojiSegment, text: string): void => {
  if (!isNonNegativeInteger(segment.index)) {
    throw new ValidationError(
      "line",
      `Emoji index must be a non-negative integer, got ${String(segment.index)}`
    );
  }

  if (segment.index >= text.length) {
    throw new ValidationError(
      "line",
      `Emoji at index ${segment.index} is past the text length of ${text.length}`
    );
  }

  if (text[segment.index] !== EMOJI_PLACEHOLDER) {
    throw new ValidationError(
      "line",
      `Emoji at index ${segment.index} must line up with a "${EMOJI_PLACEHOLDER}" in the text, found "${text[segment.index]}"`
    );
  }

  if (!isNonEmptyString(segment.productId)) {
    throw new ValidationError(
      "line",
      "Each emoji must set a non-empty `productId`"
    );
  }

  if (!isNonEmptyString(segment.emojiId)) {
    throw new ValidationError(
      "line",
      "Each emoji must set a non-empty `emojiId`"
    );
  }
};

/**
 * Validates emoji segments against the text and returns them sorted by index.
 *
 * Each emoji replaces exactly one `$`, so a segment carries no length of its
 * own and two emoji at the same index collide, which the encoder rejects.
 */
export const normalizeEmojiSegments = (
  text: string,
  segments: LineEmojiSegment[]
): LineEmojiSegment[] => {
  for (const segment of segments) {
    validateSegment(segment, text);
  }

  return segments.toSorted((a, b) => a.index - b.index);
};
