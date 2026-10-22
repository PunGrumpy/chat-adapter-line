import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import type {
  LineMessageEvent,
  LineSticker,
  LineStickerResourceType,
  LineTextOptions,
} from "../types.js";
import { isRecord } from "./is-record.js";

/** LINE returns at most 15 keywords, chosen at random when the sticker has more. */
export const MAX_STICKER_KEYWORDS = 15;

const STICKER_ID_PATTERN = /^\d+$/;

const SENDABLE_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "STATIC",
  "ANIMATION",
  "SOUND",
  "ANIMATION_SOUND",
  "POPUP",
  "POPUP_SOUND",
]);

const UNSENDABLE_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "CUSTOM",
  "MESSAGE",
  "NAME_TEXT",
  "PER_STICKER_TEXT",
]);

const isKnownResourceType = (value: string): boolean =>
  SENDABLE_RESOURCE_TYPES.has(value) || UNSENDABLE_RESOURCE_TYPES.has(value);

const readResourceType = (
  value: unknown
): LineStickerResourceType | undefined =>
  typeof value === "string" && isKnownResourceType(value)
    ? (value as LineStickerResourceType)
    : undefined;

const readKeywords = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const keywords = value
    .filter((keyword): keyword is string => typeof keyword === "string")
    .slice(0, MAX_STICKER_KEYWORDS);

  return keywords.length > 0 ? keywords : undefined;
};

/**
 * Reads the sticker identity off an inbound sticker message event.
 *
 * Returns undefined for any other message type, and for a sticker event
 * missing the IDs that identify the sticker. Unknown resource types and
 * non-string keywords are dropped rather than rejected, so a sticker LINE
 * adds later still arrives with its identity intact.
 */
export const parseInboundSticker = (
  message: LineMessageEvent["message"]
): LineSticker | undefined => {
  if (message.type !== "sticker") {
    return undefined;
  }

  const { packageId, stickerId } = message;

  if (
    typeof packageId !== "string" ||
    packageId === "" ||
    typeof stickerId !== "string" ||
    stickerId === ""
  ) {
    return undefined;
  }

  const sticker: LineSticker = { packageId, stickerId };

  const resourceType = readResourceType(message.stickerResourceType);
  if (resourceType !== undefined) {
    sticker.resourceType = resourceType;
  }

  const keywords = readKeywords(message.keywords);
  if (keywords !== undefined) {
    sticker.keywords = keywords;
  }

  if (typeof message.text === "string" && message.text !== "") {
    sticker.text = message.text;
  }

  return sticker;
};

const readStickerId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !STICKER_ID_PATTERN.test(value)) {
    throw new ValidationError(
      "line",
      `sticker.${field} must be a decimal ID from LINE's sticker definitions, got ${String(value)}`
    );
  }

  return value;
};

const rejectUnsendableResourceType = (value: unknown): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string") {
    throw new ValidationError(
      "line",
      `sticker.resourceType must be a string, got ${String(value)}`
    );
  }

  if (UNSENDABLE_RESOURCE_TYPES.has(value)) {
    throw new ValidationError(
      "line",
      `LINE cannot send a ${value} sticker, because its text comes from the sender. Send a sticker from LINE's sticker definitions instead.`
    );
  }
};

/**
 * Builds the outbound LINE sticker message for a `sticker` postable.
 *
 * LINE renders the sticker from its IDs alone, so an inbound
 * `LineMessage.sticker` can be passed straight back. The resource types that
 * carry sender text are the exception: they are rejected rather than sent as
 * the wrong sticker.
 */
export const buildStickerMessage = (
  sticker: unknown,
  options: LineTextOptions = {}
): messagingApi.StickerMessage => {
  if (!isRecord(sticker)) {
    throw new ValidationError("line", "sticker must be an object");
  }

  const packageId = readStickerId(sticker.packageId, "packageId");
  const stickerId = readStickerId(sticker.stickerId, "stickerId");
  rejectUnsendableResourceType(sticker.resourceType);

  const quote =
    options.quoteToken === undefined ? {} : { quoteToken: options.quoteToken };

  return { packageId, stickerId, type: "sticker", ...quote };
};
