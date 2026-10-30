import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";
import type { AdapterPostableMessage, CardElement, Root } from "chat";
import { isCardElement } from "chat";

import type { LinePostableMessage, LineTextOptions } from "../types.js";
import { hasSdkEmojiPlaceholder, renderSdkEmoji } from "./emojis.js";
import { buildFlexMessage, buildNativeFlexMessage } from "./flex-messages.js";
import type { LineFormatConverter } from "./format-converter.js";
import { isRecord } from "./is-record.js";
import { buildLocationMessage } from "./locations.js";
import { buildAudioMessage, buildMediaMessage } from "./media.js";
import { buildStickerMessage } from "./stickers.js";
import { buildTextMessages } from "./text-v2.js";

export const MAX_MESSAGES_PER_REQUEST = 5;

export const MAX_MULTICAST_RECIPIENTS = 500;

const MAX_AGGREGATION_UNITS = 1;
const AGGREGATION_UNIT_PATTERN = /^[a-zA-Z0-9_]{1,30}$/;

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readTextOptions = (message: Record<string, unknown>): LineTextOptions => {
  const options: LineTextOptions = {};

  if (message.quoteToken !== undefined) {
    if (typeof message.quoteToken !== "string" || message.quoteToken === "") {
      throw new ValidationError(
        "line",
        "quoteToken must be a non-empty string"
      );
    }
    options.quoteToken = message.quoteToken;
  }

  if (message.mentions !== undefined) {
    if (!Array.isArray(message.mentions)) {
      throw new ValidationError("line", "mentions must be an array");
    }
    options.mentions = message.mentions;
  }

  if (message.emojis !== undefined) {
    if (!Array.isArray(message.emojis)) {
      throw new ValidationError("line", "emojis must be an array");
    }
    options.emojis = message.emojis;
  }

  return options;
};

const rejectQuote = (options: LineTextOptions, kind: string): void => {
  if (options.quoteToken !== undefined) {
    throw new ValidationError(
      "line",
      `LINE cannot quote a message from a ${kind} message. Send a text message instead.`
    );
  }
};

const rejectMentionsAndEmoji = (
  options: LineTextOptions,
  kind: string
): void => {
  if (options.mentions !== undefined && options.mentions.length > 0) {
    throw new ValidationError(
      "line",
      `LINE cannot encode mentions into a ${kind} message. Send a \`text\` or \`raw\` message instead.`
    );
  }

  if (options.emojis !== undefined && options.emojis.length > 0) {
    throw new ValidationError(
      "line",
      `LINE cannot encode emoji into a ${kind} message. Send a \`text\` or \`raw\` message instead.`
    );
  }
};

const renderTextWithSdkEmoji = (
  text: string,
  options: LineTextOptions
): string => {
  if (!hasSdkEmojiPlaceholder(text)) {
    return text;
  }

  if (
    (options.mentions?.length ?? 0) > 0 ||
    (options.emojis?.length ?? 0) > 0
  ) {
    throw new ValidationError(
      "line",
      "Use Unicode emoji instead of the SDK's emoji placeholders in a message with positioned mentions or LINE emoji"
    );
  }

  return renderSdkEmoji(text);
};

/**
 * Converts one postable into LINE Messaging API message objects.
 *
 * Cards and `flex` payloads become Flex Messages. Audio, image, video,
 * location, and sticker postables become native messages of their own,
 * and everything else renders to text. Quote tokens, mentions, and emoji
 * are only accepted where LINE can carry them; other combinations throw
 * instead of silently dropping the LINE-specific data.
 */
export const toLineMessages = (
  message: LinePostableMessage,
  converter: LineFormatConverter
): messagingApi.Message[] => {
  if (typeof message === "string") {
    return buildTextMessages(renderSdkEmoji(message));
  }

  if (!isRecord(message)) {
    throw new ValidationError("line", "No message content to send");
  }

  const options = readTextOptions(message);

  if ("flex" in message) {
    rejectQuote(options, "flex");
    rejectMentionsAndEmoji(options, "flex");
    return [buildNativeFlexMessage(message.flex)];
  }

  const card = isCardElement(message)
    ? message
    : (message.card as CardElement | undefined);
  if (card) {
    rejectQuote(options, "card");
    rejectMentionsAndEmoji(options, "card");
    return [buildFlexMessage(card)];
  }

  if ("audio" in message) {
    rejectQuote(options, "audio");
    rejectMentionsAndEmoji(options, "audio");
    return [buildAudioMessage(message.audio)];
  }

  if ("image" in message) {
    rejectQuote(options, "image");
    rejectMentionsAndEmoji(options, "image");
    return [buildMediaMessage(message.image, "image")];
  }

  if ("video" in message) {
    rejectQuote(options, "video");
    rejectMentionsAndEmoji(options, "video");
    return [buildMediaMessage(message.video, "video")];
  }

  if ("location" in message) {
    rejectQuote(options, "location");
    rejectMentionsAndEmoji(options, "location");
    return [buildLocationMessage(message.location)];
  }

  if ("sticker" in message) {
    rejectMentionsAndEmoji(options, "sticker");
    return [buildStickerMessage(message.sticker, options)];
  }

  if (typeof message.text === "string") {
    return buildTextMessages(
      renderTextWithSdkEmoji(message.text, options),
      options
    );
  }

  if (typeof message.raw === "string") {
    return buildTextMessages(
      renderTextWithSdkEmoji(message.raw, options),
      options
    );
  }

  if (typeof message.markdown === "string") {
    rejectMentionsAndEmoji(options, "markdown");
    const rendered = converter.renderPostable(
      message as AdapterPostableMessage
    );
    return buildTextMessages(rendered, options);
  }

  if (message.ast) {
    rejectMentionsAndEmoji(options, "ast");
    const rendered = converter.fromAst(message.ast as Root);
    return buildTextMessages(rendered, options);
  }

  throw new ValidationError("line", "No message content to send");
};

export const hasMentionSubstitution = (
  message: messagingApi.Message
): boolean =>
  message.type === "textV2" &&
  Object.values(message.substitution ?? {}).some(
    (entry) => entry.type === "mention"
  );

export const toBatchLineMessages = (
  messages: LinePostableMessage | LinePostableMessage[],
  converter: LineFormatConverter
): messagingApi.Message[] => {
  const postables = Array.isArray(messages) ? messages : [messages];

  if (postables.length === 0) {
    throw new ValidationError("line", "No message content to send");
  }

  const lineMessages: messagingApi.Message[] = [];
  for (const postable of postables) {
    lineMessages.push(...toLineMessages(postable, converter));
  }

  if (lineMessages.length > MAX_MESSAGES_PER_REQUEST) {
    throw new ValidationError(
      "line",
      `LINE accepts at most ${MAX_MESSAGES_PER_REQUEST} messages per request, got ${lineMessages.length}`
    );
  }

  if (lineMessages.some(hasMentionSubstitution)) {
    throw new ValidationError(
      "line",
      "LINE only renders mentions on reply and push messages, not broadcast or multicast"
    );
  }

  return lineMessages;
};

export const validateRetryKey = (retryKey?: string): void => {
  if (retryKey !== undefined && !UUID_PATTERN.test(retryKey)) {
    throw new ValidationError(
      "line",
      `retryKey must be a UUID (e.g. 123e4567-e89b-12d3-a456-426614174000), got ${retryKey}`
    );
  }
};

export const validateAggregationUnits = (units?: string[]): void => {
  if (units === undefined) {
    return;
  }

  if (!Array.isArray(units) || units.length > MAX_AGGREGATION_UNITS) {
    throw new ValidationError(
      "line",
      `customAggregationUnits accepts at most ${MAX_AGGREGATION_UNITS} unit name`
    );
  }

  for (const unit of units) {
    if (typeof unit !== "string" || !AGGREGATION_UNIT_PATTERN.test(unit)) {
      throw new ValidationError(
        "line",
        `Aggregation unit names must be 1 to 30 alphanumeric or underscore characters, got ${String(unit)}`
      );
    }
  }
};

export const validateMulticastRecipients = (userIds: string[]): void => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ValidationError(
      "line",
      "multicast requires at least one LINE user ID"
    );
  }

  if (userIds.length > MAX_MULTICAST_RECIPIENTS) {
    throw new ValidationError(
      "line",
      `LINE multicast accepts at most ${MAX_MULTICAST_RECIPIENTS} recipients per request, got ${userIds.length}`
    );
  }

  for (const userId of userIds) {
    if (typeof userId !== "string" || !LINE_USER_ID_PATTERN.test(userId)) {
      throw new ValidationError(
        "line",
        `Invalid LINE user ID: ${String(userId)}. Use the userId values from webhook events.`
      );
    }
  }
};

/**
 * Types a LINE-native postable for `thread.post()`.
 *
 * The Chat SDK's `PostableMessage` union does not know about `audio`,
 * `quoteToken`, or `mentions`, so passing one as an object literal fails
 * TypeScript's excess property check. The adapter accepts the wider
 * `LinePostableMessage` at runtime; this helper only narrows the static type.
 *
 * @example
 * ```ts
 * await thread.post(linePostable({ text: "Got it", quoteToken }));
 * ```
 */
export const linePostable = (
  message: LinePostableMessage
): AdapterPostableMessage => message as AdapterPostableMessage;
