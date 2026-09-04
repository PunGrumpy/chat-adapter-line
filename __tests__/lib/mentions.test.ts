import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTextMessage,
  MAX_MENTIONS_PER_MESSAGE,
  parseInboundMentions,
} from "../../src/lib/mentions.js";
import type { LineMessageEvent } from "../../src/types.js";

const textMessage = (
  overrides: Partial<LineMessageEvent["message"]> = {}
): LineMessageEvent["message"] => ({
  id: "msg-1",
  text: "hello",
  type: "text",
  ...overrides,
});

describe("parseInboundMentions", () => {
  it("returns an empty array when there is no mention block", () => {
    expect(parseInboundMentions(textMessage())).toEqual([]);
  });

  it("returns an empty array when mentionees is not an array", () => {
    expect(
      parseInboundMentions(
        textMessage({ mention: { mentionees: "nope" as never } })
      )
    ).toEqual([]);
  });

  it("keeps user and all mentionees with their offsets", () => {
    const mentions = parseInboundMentions(
      textMessage({
        mention: {
          mentionees: [
            { index: 0, isSelf: true, length: 4, type: "user", userId: "U1" },
            { index: 5, length: 4, type: "all" },
            { index: 10, length: 3, type: "user" },
          ],
        },
        text: "@Bot @All @Al",
      })
    );

    expect(mentions).toEqual([
      { index: 0, isSelf: true, length: 4, type: "user", userId: "U1" },
      { index: 5, length: 4, type: "all" },
      { index: 10, length: 3, type: "user" },
    ]);
  });

  it("drops entries with unknown types or missing offsets", () => {
    const mentions = parseInboundMentions(
      textMessage({
        mention: {
          mentionees: [
            { index: 0, length: 4, type: "channel" },
            { length: 4, type: "user" },
            { index: 0, type: "user" },
            { index: 0, length: 4, type: "user", userId: 7 },
          ] as never,
        },
      })
    );

    expect(mentions).toEqual([{ index: 0, length: 4, type: "user" }]);
  });
});

describe("buildTextMessage", () => {
  it("builds a plain text message without options", () => {
    expect(buildTextMessage("hi")).toEqual({ text: "hi", type: "text" });
  });

  it("adds the quote token to a plain text message", () => {
    expect(buildTextMessage("hi", { quoteToken: "qt" })).toEqual({
      quoteToken: "qt",
      text: "hi",
      type: "text",
    });
  });

  it("treats an empty mentions array as plain text", () => {
    expect(buildTextMessage("hi", { mentions: [] })).toEqual({
      text: "hi",
      type: "text",
    });
  });

  it("encodes a user mention as a textV2 placeholder", () => {
    expect(
      buildTextMessage("Hello @Alice, welcome", {
        mentions: [{ index: 6, length: 6, userId: "U-alice" }],
      })
    ).toEqual({
      substitution: {
        mention0: {
          mentionee: { type: "user", userId: "U-alice" },
          type: "mention",
        },
      },
      text: "Hello {mention0}, welcome",
      type: "textV2",
    });
  });

  it("encodes an all mention", () => {
    expect(
      buildTextMessage("@everyone hi", {
        mentions: [{ all: true, index: 0, length: 9 }],
      })
    ).toEqual({
      substitution: {
        mention0: { mentionee: { type: "all" }, type: "mention" },
      },
      text: "{mention0} hi",
      type: "textV2",
    });
  });

  it("orders placeholders by index regardless of input order", () => {
    const message = buildTextMessage("@A and @B", {
      mentions: [
        { index: 7, length: 2, userId: "U-b" },
        { index: 0, length: 2, userId: "U-a" },
      ],
    });

    expect(message).toEqual({
      substitution: {
        mention0: {
          mentionee: { type: "user", userId: "U-a" },
          type: "mention",
        },
        mention1: {
          mentionee: { type: "user", userId: "U-b" },
          type: "mention",
        },
      },
      text: "{mention0} and {mention1}",
      type: "textV2",
    });
  });

  it("escapes literal braces outside mentions", () => {
    const message = buildTextMessage("{x} @A {y}", {
      mentions: [{ index: 4, length: 2, userId: "U-a" }],
    });

    expect(message.text).toBe("{{x}} {mention0} {{y}}");
  });

  it("keeps the quote token on a textV2 message", () => {
    const message = buildTextMessage("@A", {
      mentions: [{ index: 0, length: 2, userId: "U-a" }],
      quoteToken: "qt",
    });

    expect(message).toMatchObject({ quoteToken: "qt", type: "textV2" });
  });

  it.each([
    ["negative index", { index: -1, length: 2, userId: "U" }],
    ["fractional index", { index: 0.5, length: 2, userId: "U" }],
    ["zero length", { index: 0, length: 0, userId: "U" }],
    ["out of range", { index: 4, length: 5, userId: "U" }],
    ["no target", { index: 0, length: 2 }],
    ["empty userId", { index: 0, length: 2, userId: "" }],
    ["both targets", { all: true, index: 0, length: 2, userId: "U" }],
  ])("rejects a mention with %s", (_label, segment) => {
    expect(() => buildTextMessage("@A hello", { mentions: [segment] })).toThrow(
      ValidationError
    );
  });

  it("accepts up to the per-message mention limit", () => {
    const text = "@".repeat(MAX_MENTIONS_PER_MESSAGE);
    const mentions = Array.from(
      { length: MAX_MENTIONS_PER_MESSAGE },
      (_, i) => ({
        index: i,
        length: 1,
        userId: `U${i}`,
      })
    );

    expect(buildTextMessage(text, { mentions }).type).toBe("textV2");
  });

  it("rejects more mentions than LINE substitutes", () => {
    const count = MAX_MENTIONS_PER_MESSAGE + 1;
    const text = "@".repeat(count);
    const mentions = Array.from({ length: count }, (_, i) => ({
      index: i,
      length: 1,
      userId: `U${i}`,
    }));

    expect(() => buildTextMessage(text, { mentions })).toThrow(
      /at most 20 mentions/
    );
  });

  it("rejects overlapping mentions", () => {
    expect(() =>
      buildTextMessage("@Alice", {
        mentions: [
          { index: 0, length: 4, userId: "U-a" },
          { index: 2, length: 4, userId: "U-b" },
        ],
      })
    ).toThrow(/overlap/);
  });

  it("allows adjacent mentions", () => {
    const message = buildTextMessage("@A@B", {
      mentions: [
        { index: 0, length: 2, userId: "U-a" },
        { index: 2, length: 2, userId: "U-b" },
      ],
    });

    expect(message.text).toBe("{mention0}{mention1}");
  });
});
