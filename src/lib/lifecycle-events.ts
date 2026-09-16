import type {
  LineEventSource,
  LineLifecycleEvent,
  LineLifecycleRawEvent,
} from "../types.js";
import { isRecord } from "./is-record.js";

const LIFECYCLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "follow",
  "unfollow",
  "join",
  "leave",
  "memberJoined",
  "memberLeft",
]);

const isSource = (value: unknown): value is LineEventSource =>
  isRecord(value) &&
  (value.type === "user" || value.type === "group" || value.type === "room");

/**
 * Recognizes a lifecycle event in a raw webhook payload.
 *
 * A reply token is not required, because LINE omits one on `unfollow`,
 * `leave`, and `memberLeft`, the very events a bot most needs to see.
 */
export const isLifecycleEvent = (
  event: unknown
): event is LineLifecycleRawEvent =>
  isRecord(event) &&
  typeof event.type === "string" &&
  LIFECYCLE_EVENT_TYPES.has(event.type) &&
  isSource(event.source) &&
  typeof event.timestamp === "number" &&
  typeof event.webhookEventId === "string";

const readMembers = (members: unknown): string[] | undefined => {
  if (!Array.isArray(members)) {
    return undefined;
  }

  const userIds = members
    .filter(isRecord)
    .map((member) => member.userId)
    .filter((userId): userId is string => typeof userId === "string");

  return userIds.length > 0 ? userIds : undefined;
};

/**
 * Flattens a raw lifecycle event onto the public shape.
 *
 * Optional fields are left off rather than filled with a placeholder, so a
 * missing member list or reply token reads as absent instead of empty.
 */
export const toLifecycleEvent = (
  event: LineLifecycleRawEvent,
  threadId: string,
  sourceId: string
): LineLifecycleEvent => {
  const lifecycle: LineLifecycleEvent = {
    isRedelivery: event.deliveryContext?.isRedelivery === true,
    mode: event.mode === "standby" ? "standby" : "active",
    raw: event,
    sourceId,
    sourceType: event.source.type,
    threadId,
    timestamp: new Date(event.timestamp),
    type: event.type,
    webhookEventId: event.webhookEventId,
  };

  if (typeof event.source.userId === "string") {
    lifecycle.userId = event.source.userId;
  }

  if (typeof event.replyToken === "string" && event.replyToken !== "") {
    lifecycle.replyToken = event.replyToken;
  }

  const members = readMembers(event.joined?.members ?? event.left?.members);
  if (members !== undefined) {
    lifecycle.members = members;
  }

  if (typeof event.follow?.isUnblocked === "boolean") {
    lifecycle.isUnblocked = event.follow.isUnblocked;
  }

  return lifecycle;
};
