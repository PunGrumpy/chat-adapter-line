import { extractCard, ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";
import type { AdapterPostableMessage, Root } from "chat";

import type { LinePostableMessage, LineTextOptions } from "../types.js";
import { buildFlexMessage } from "./flex-messages.js";
import type { LineFormatConverter } from "./format-converter.js";
import { isRecord } from "./is-record.js";
import { toPlainText } from "./to-plain-text.js";

/** LINE accepts at most five message objects per send request. */
export const MAX_MESSAGES_PER_REQUEST = 5;

/** LINE multicast accepts at most 500 user IDs per request. */
export const MAX_MULTICAST_RECIPIENTS = 500;

/** LINE caps media URLs at 2000 characters. */
const MAX_CONTENT_URL_LENGTH = 2000;

/** LINE multicast accepts one aggregation unit: up to 30 alphanumerics or underscores. */
const MAX_AGGREGATION_UNITS = 1;
const AGGREGATION_UNIT_PATTERN = /^[a-zA-Z0-9_]{1,30}$/;

/** LINE user IDs are `U` followed by 32 hex characters. */
const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;

/** `X-Line-Retry-Key` must be a hexadecimal UUID. */
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

const buildTextMessage = (
  text: string,
  options: LineTextOptions
): messagingApi.TextMessage => ({
  text,
  type: "text",
  ...(options.quoteToken === undefined
    ? {}
    : { quoteToken: options.quoteToken }),
});

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const buildAudioMessage = (audio: unknown): messagingApi.AudioMessage => {
  if (!isRecord(audio)) {
    throw new ValidationError("line", "audio must be an object");
  }

  const { originalContentUrl, duration } = audio;

  if (
    typeof originalContentUrl !== "string" ||
    !isHttpsUrl(originalContentUrl)
  ) {
    throw new ValidationError(
      "line",
      "audio.originalContentUrl must be an HTTPS URL"
    );
  }

  if (originalContentUrl.length > MAX_CONTENT_URL_LENGTH) {
    throw new ValidationError(
      "line",
      `audio.originalContentUrl must be at most ${MAX_CONTENT_URL_LENGTH} characters`
    );
  }

  if (!Number.isInteger(duration) || (duration as number) <= 0) {
    throw new ValidationError(
      "line",
      "audio.duration must be a positive integer number of milliseconds"
    );
  }

  return { duration: duration as number, originalContentUrl, type: "audio" };
};

/**
 * Converts one postable into LINE Messaging API message objects.
 *
 * Cards become Flex Messages, audio becomes a native audio message, and
 * everything else renders to text. Quote tokens are only accepted where
 * LINE can carry them; other combinations throw instead of silently
 * dropping the LINE-specific data.
 */
export const toLineMessages = (
  message: LinePostableMessage,
  converter: LineFormatConverter
): messagingApi.Message[] => {
  if (typeof message === "string") {
    return [{ text: message, type: "text" }];
  }

  if (!isRecord(message)) {
    throw new ValidationError("line", "No message content to send");
  }

  const options = readTextOptions(message);

  const card = extractCard(message as AdapterPostableMessage);
  if (card) {
    rejectQuote(options, "card");
    return [buildFlexMessage(card)];
  }

  if ("audio" in message) {
    rejectQuote(options, "audio");
    return [buildAudioMessage(message.audio)];
  }

  if (typeof message.text === "string") {
    return [buildTextMessage(message.text, options)];
  }

  if (typeof message.raw === "string") {
    return [buildTextMessage(message.raw, options)];
  }

  if (typeof message.markdown === "string") {
    const rendered = converter.renderPostable(
      message as AdapterPostableMessage
    );
    return [buildTextMessage(rendered, options)];
  }

  if (message.ast) {
    const rendered = converter.fromAst(message.ast as Root);
    return [buildTextMessage(toPlainText(rendered), options)];
  }

  throw new ValidationError("line", "No message content to send");
};

/**
 * Converts one or more postables for a batch send. Throws when the result
 * exceeds LINE's per-request limit rather than truncating, because a dropped
 * message would silently reach the whole audience incomplete.
 */
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
 * The Chat SDK's `PostableMessage` union does not know about `audio` or
 * `quoteToken`, so passing one as an object literal fails TypeScript's excess
 * property check.
 * The adapter accepts the wider `LinePostableMessage` at runtime; this helper
 * only narrows the static type.
 *
 * @example
 * ```ts
 * await thread.post(linePostable({ text: "Got it", quoteToken }));
 * ```
 */
export const linePostable = (
  message: LinePostableMessage
): AdapterPostableMessage => message as AdapterPostableMessage;
