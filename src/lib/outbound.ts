import { extractCard, ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";
import type { AdapterPostableMessage, Root } from "chat";

import { buildFlexMessage } from "./flex-messages.js";
import type { LineFormatConverter } from "./format-converter.js";
import { isRecord } from "./is-record.js";
import { toPlainText } from "./to-plain-text.js";

/** LINE accepts at most five message objects per send request. */
export const MAX_MESSAGES_PER_REQUEST = 5;

/** LINE multicast accepts at most 500 user IDs per request. */
export const MAX_MULTICAST_RECIPIENTS = 500;

/** LINE multicast accepts one aggregation unit: up to 30 alphanumerics or underscores. */
const MAX_AGGREGATION_UNITS = 1;
const AGGREGATION_UNIT_PATTERN = /^[a-zA-Z0-9_]{1,30}$/;

/** LINE user IDs are `U` followed by 32 hex characters. */
const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;

/** `X-Line-Retry-Key` must be a hexadecimal UUID. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converts one postable into LINE Messaging API message objects.
 *
 * Cards become Flex Messages and everything else renders to text.
 */
export const toLineMessages = (
  message: AdapterPostableMessage,
  converter: LineFormatConverter
): messagingApi.Message[] => {
  if (typeof message === "string") {
    return [{ text: message, type: "text" }];
  }

  if (!isRecord(message)) {
    throw new ValidationError("line", "No message content to send");
  }

  const card = extractCard(message);
  if (card) {
    return [buildFlexMessage(card)];
  }

  if (typeof message.text === "string") {
    return [{ text: message.text, type: "text" }];
  }

  if (typeof message.raw === "string") {
    return [{ text: message.raw, type: "text" }];
  }

  if (typeof message.markdown === "string") {
    return [{ text: converter.renderPostable(message), type: "text" }];
  }

  if (message.ast) {
    const rendered = converter.fromAst(message.ast as Root);
    return [{ text: toPlainText(rendered), type: "text" }];
  }

  throw new ValidationError("line", "No message content to send");
};

/**
 * Converts one or more postables for a batch send. Throws when the result
 * exceeds LINE's per-request limit rather than truncating, because a dropped
 * message would silently reach the whole audience incomplete.
 */
export const toBatchLineMessages = (
  messages: AdapterPostableMessage | AdapterPostableMessage[],
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
