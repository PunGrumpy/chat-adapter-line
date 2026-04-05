import type { LineThreadId } from "../types.js";

const LINE_THREAD_ID_PREFIX = "line:" as const;

/**
 * Encode a LINE thread ID from its components.
 * Format: line:<channelId>:<sourceType>:<sourceId>
 */
export const encodeThreadId = (
  sourceType: "user" | "group" | "room",
  channelId: string,
  sourceId: string
): string => `${LINE_THREAD_ID_PREFIX}${channelId}:${sourceType}:${sourceId}`;

/**
 * Decode a LINE thread ID into its components.
 * @throws Error if the thread ID format is invalid
 */
export const decodeThreadId = (threadId: string): LineThreadId => {
  if (!threadId.startsWith(LINE_THREAD_ID_PREFIX)) {
    throw new Error(`Invalid LINE thread ID: ${threadId}`);
  }

  const rest = threadId.slice(LINE_THREAD_ID_PREFIX.length);
  const firstColon = rest.indexOf(":");

  if (firstColon === -1) {
    throw new Error(
      `Invalid LINE thread ID format: ${threadId}. Expected "line:<channelId>:<sourceType>:<sourceId>"`
    );
  }

  const channelId = rest.slice(0, firstColon);
  const remainder = rest.slice(firstColon + 1);
  const parts = remainder.split(":");

  if (parts.length < 2) {
    throw new Error(
      `Invalid LINE thread ID format: ${threadId}. Missing sourceType and sourceId.`
    );
  }

  const [sourceType] = parts;
  if (
    sourceType !== "user" &&
    sourceType !== "group" &&
    sourceType !== "room"
  ) {
    throw new Error(
      `Invalid source type in thread ID: ${sourceType}. Must be "user", "group", or "room"`
    );
  }

  const sourceId = parts.slice(1).join(":");

  return { channelId, sourceId, sourceType };
};

/**
 * Check if a thread ID represents a 1:1 DM.
 */
export const isDM = (threadId: string): boolean => {
  try {
    const { sourceType } = decodeThreadId(threadId);
    return sourceType === "user";
  } catch {
    return false;
  }
};
