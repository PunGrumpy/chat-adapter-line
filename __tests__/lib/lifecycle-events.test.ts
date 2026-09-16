import { describe, expect, it } from "vite-plus/test";

import {
  isLifecycleEvent,
  toLifecycleEvent,
} from "../../src/lib/lifecycle-events.js";
import type { LineLifecycleRawEvent } from "../../src/types.js";

const rawEvent = (
  overrides: Partial<LineLifecycleRawEvent> = {}
): LineLifecycleRawEvent => ({
  deliveryContext: { isRedelivery: false },
  mode: "active",
  source: { type: "user", userId: "u-123" },
  timestamp: 1_700_000_000_000,
  type: "follow",
  webhookEventId: "evt-1",
  ...overrides,
});

describe("isLifecycleEvent", () => {
  it.each([
    "follow",
    "unfollow",
    "join",
    "leave",
    "memberJoined",
    "memberLeft",
  ])("accepts a %s event", (type) => {
    expect(isLifecycleEvent(rawEvent({ type } as never))).toBe(true);
  });

  it("accepts an event with no reply token", () => {
    expect(isLifecycleEvent(rawEvent({ type: "unfollow" }))).toBe(true);
  });

  it.each([
    ["a message event", { type: "message" }],
    ["a postback event", { type: "postback" }],
    ["an unknown type", { type: "videoPlayComplete" }],
    ["a missing source", { source: undefined }],
    ["a source with no type", { source: {} }],
    ["a source of an unknown type", { source: { type: "channel" } }],
    ["a missing timestamp", { timestamp: undefined }],
    ["a missing webhookEventId", { webhookEventId: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(isLifecycleEvent(rawEvent(overrides as never))).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "follow"],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isLifecycleEvent(value)).toBe(false);
  });
});

describe("toLifecycleEvent", () => {
  const threadId = "line:ch-1:user:u-123";

  it("flattens the event onto the public shape", () => {
    const event = rawEvent({ replyToken: "rt-1" });

    expect(toLifecycleEvent(event, threadId, "u-123")).toEqual({
      isRedelivery: false,
      mode: "active",
      raw: event,
      replyToken: "rt-1",
      sourceId: "u-123",
      sourceType: "user",
      threadId,
      timestamp: new Date(1_700_000_000_000),
      type: "follow",
      userId: "u-123",
      webhookEventId: "evt-1",
    });
  });

  it("leaves the reply token off an event LINE issues none for", () => {
    const event = toLifecycleEvent(
      rawEvent({ type: "unfollow" }),
      threadId,
      "u-123"
    );

    expect(event.replyToken).toBeUndefined();
    expect(event.type).toBe("unfollow");
  });

  it("preserves a redelivery flag", () => {
    expect(
      toLifecycleEvent(
        rawEvent({ deliveryContext: { isRedelivery: true } }),
        threadId,
        "u-123"
      ).isRedelivery
    ).toBe(true);
  });

  it("preserves standby mode", () => {
    expect(
      toLifecycleEvent(rawEvent({ mode: "standby" }), threadId, "u-123").mode
    ).toBe("standby");
  });

  it("reads the members who joined", () => {
    const event = toLifecycleEvent(
      rawEvent({
        joined: {
          members: [
            { type: "user", userId: "u-1" },
            { type: "user", userId: "u-2" },
          ],
        },
        source: { groupId: "g-1", type: "group" },
        type: "memberJoined",
      }),
      "line:ch-1:group:g-1",
      "g-1"
    );

    expect(event.members).toEqual(["u-1", "u-2"]);
    expect(event.sourceType).toBe("group");
    expect(event.userId).toBeUndefined();
  });

  it("reads the members who left", () => {
    expect(
      toLifecycleEvent(
        rawEvent({
          left: { members: [{ type: "user", userId: "u-1" }] },
          source: { roomId: "r-1", type: "room" },
          type: "memberLeft",
        }),
        "line:ch-1:room:r-1",
        "r-1"
      ).members
    ).toEqual(["u-1"]);
  });

  it("drops members LINE reports without a user ID", () => {
    const event = toLifecycleEvent(
      rawEvent({
        joined: { members: [{ type: "user" }] },
        type: "memberJoined",
      }),
      threadId,
      "u-123"
    );

    expect(event.members).toBeUndefined();
  });

  it("reports whether a follow came from an unblock", () => {
    expect(
      toLifecycleEvent(
        rawEvent({ follow: { isUnblocked: true } }),
        threadId,
        "u-123"
      ).isUnblocked
    ).toBe(true);
  });

  it("leaves isUnblocked off when LINE omits it", () => {
    expect(
      toLifecycleEvent(rawEvent(), threadId, "u-123").isUnblocked
    ).toBeUndefined();
  });
});
