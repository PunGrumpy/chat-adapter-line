import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import { isRecord } from "./is-record.js";

/** LINE caps media URLs at 2000 characters. */
const MAX_CONTENT_URL_LENGTH = 2000;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Reads one media URL. LINE fetches the file itself rather than taking bytes
 * from the bot, so the URL has to be HTTPS and reachable from the internet.
 */
const readContentUrl = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !isHttpsUrl(value)) {
    throw new ValidationError("line", `${field} must be an HTTPS URL`);
  }

  if (value.length > MAX_CONTENT_URL_LENGTH) {
    throw new ValidationError(
      "line",
      `${field} must be at most ${MAX_CONTENT_URL_LENGTH} characters`
    );
  }

  return value;
};

/**
 * Builds the outbound LINE audio message for an `audio` postable.
 *
 * LINE needs the length up front to draw the player, and has no way to read
 * it from the file, so the caller supplies it.
 */
export const buildAudioMessage = (
  audio: unknown
): messagingApi.AudioMessage => {
  if (!isRecord(audio)) {
    throw new ValidationError("line", "audio must be an object");
  }

  const originalContentUrl = readContentUrl(
    audio.originalContentUrl,
    "audio.originalContentUrl"
  );
  const { duration } = audio;

  if (!isPositiveInteger(duration)) {
    throw new ValidationError(
      "line",
      "audio.duration must be a positive integer number of milliseconds"
    );
  }

  return { duration, originalContentUrl, type: "audio" };
};

/**
 * Builds the outbound LINE image or video message for an `image` or `video`
 * postable. The two carry the same pair of URLs and differ only in the type
 * LINE renders them as.
 */
export const buildMediaMessage = (
  media: unknown,
  type: "image" | "video"
): messagingApi.ImageMessage | messagingApi.VideoMessage => {
  if (!isRecord(media)) {
    throw new ValidationError("line", `${type} must be an object`);
  }

  return {
    originalContentUrl: readContentUrl(
      media.originalContentUrl,
      `${type}.originalContentUrl`
    ),
    previewImageUrl: readContentUrl(
      media.previewImageUrl,
      `${type}.previewImageUrl`
    ),
    type,
  };
};
