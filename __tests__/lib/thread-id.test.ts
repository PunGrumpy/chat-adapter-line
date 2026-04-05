import { describe, expect, it } from "vite-plus/test";

import {
  decodeThreadId,
  encodeThreadId,
  isDM,
} from "../../src/lib/thread-id.js";

describe("encodeThreadId", () => {
  it("encodes a user thread ID", () => {
    const result = encodeThreadId("user", "ch-123", "u-abc");
    expect(result).toBe("line:ch-123:user:u-abc");
  });

  it("encodes a group thread ID", () => {
    const result = encodeThreadId("group", "ch-456", "g-xyz");
    expect(result).toBe("line:ch-456:group:g-xyz");
  });

  it("encodes a room thread ID", () => {
    const result = encodeThreadId("room", "ch-789", "r-111");
    expect(result).toBe("line:ch-789:room:r-111");
  });

  it("preserves colons in sourceId", () => {
    const result = encodeThreadId("user", "ch-1", "u:with:colons");
    expect(result).toBe("line:ch-1:user:u:with:colons");
  });
});

describe("decodeThreadId", () => {
  it("decodes a valid user thread ID", () => {
    const result = decodeThreadId("line:ch-123:user:u-abc");
    expect(result).toEqual({
      channelId: "ch-123",
      sourceId: "u-abc",
      sourceType: "user",
    });
  });

  it("decodes a valid group thread ID", () => {
    const result = decodeThreadId("line:ch-456:group:g-xyz");
    expect(result).toEqual({
      channelId: "ch-456",
      sourceId: "g-xyz",
      sourceType: "group",
    });
  });

  it("decodes a valid room thread ID", () => {
    const result = decodeThreadId("line:ch-789:room:r-111");
    expect(result).toEqual({
      channelId: "ch-789",
      sourceId: "r-111",
      sourceType: "room",
    });
  });

  it("recovers sourceId containing colons", () => {
    const result = decodeThreadId("line:ch-1:user:u:with:colons");
    expect(result).toEqual({
      channelId: "ch-1",
      sourceId: "u:with:colons",
      sourceType: "user",
    });
  });

  it("throws when prefix is missing", () => {
    expect(() => decodeThreadId("ch-123:user:u-abc")).toThrow(
      "Invalid LINE thread ID: ch-123:user:u-abc"
    );
  });

  it("throws when only prefix is present", () => {
    expect(() => decodeThreadId("line:")).toThrow(
      /Invalid LINE thread ID format/
    );
  });

  it("throws when channelId is present but rest is incomplete", () => {
    expect(() => decodeThreadId("line:ch-123")).toThrow(
      /Invalid LINE thread ID format/
    );
  });

  it("throws when sourceType is missing", () => {
    expect(() => decodeThreadId("line:ch-123:user")).toThrow(
      /Missing sourceType and sourceId/
    );
  });

  it("throws on invalid sourceType", () => {
    expect(() => decodeThreadId("line:ch-123:unknown:u-abc")).toThrow(
      /Invalid source type in thread ID/
    );
  });

  it("throws on empty string", () => {
    expect(() => decodeThreadId("")).toThrow("Invalid LINE thread ID: ");
  });
});

describe("isDM", () => {
  it("returns true for user thread ID", () => {
    expect(isDM("line:ch-123:user:u-abc")).toBe(true);
  });

  it("returns false for group thread ID", () => {
    expect(isDM("line:ch-123:group:g-xyz")).toBe(false);
  });

  it("returns false for room thread ID", () => {
    expect(isDM("line:ch-123:room:r-111")).toBe(false);
  });

  it("returns false for malformed thread ID", () => {
    expect(isDM("not-a-thread-id")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDM("")).toBe(false);
  });
});
