import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import { MAX_MENTIONS_PER_MESSAGE } from "../../src/lib/mentions.js";
import {
  buildTextMessage,
  MAX_SUBSTITUTIONS_PER_MESSAGE,
} from "../../src/lib/text-v2.js";

const PRODUCT_ID = "5ac1bfd5040ab15980c9b435";

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

  it("encodes an emoji as a textV2 substitution", () => {
    expect(
      buildTextMessage("Hello $", {
        emojis: [{ emojiId: "001", index: 6, productId: PRODUCT_ID }],
      })
    ).toEqual({
      substitution: {
        emoji0: { emojiId: "001", productId: PRODUCT_ID, type: "emoji" },
      },
      text: "Hello {emoji0}",
      type: "textV2",
    });
  });

  it("stays a plain text message when emojis is empty", () => {
    expect(buildTextMessage("hi", { emojis: [] })).toEqual({
      text: "hi",
      type: "text",
    });
  });

  it("numbers several emoji in index order", () => {
    const message = buildTextMessage("$ and $", {
      emojis: [
        { emojiId: "002", index: 6, productId: PRODUCT_ID },
        { emojiId: "001", index: 0, productId: PRODUCT_ID },
      ],
    });

    expect(message).toMatchObject({
      text: "{emoji0} and {emoji1}",
      type: "textV2",
    });
    expect(message).toHaveProperty("substitution.emoji0.emojiId", "001");
    expect(message).toHaveProperty("substitution.emoji1.emojiId", "002");
  });

  it("mixes mentions and emoji in one message", () => {
    const message = buildTextMessage("@Alice $ welcome", {
      emojis: [{ emojiId: "001", index: 7, productId: PRODUCT_ID }],
      mentions: [{ index: 0, length: 6, userId: "U1" }],
    });

    expect(message).toEqual({
      substitution: {
        emoji0: { emojiId: "001", productId: PRODUCT_ID, type: "emoji" },
        mention0: {
          mentionee: { type: "user", userId: "U1" },
          type: "mention",
        },
      },
      text: "{mention0} {emoji0} welcome",
      type: "textV2",
    });
  });

  it("carries a quote token on a message with emoji", () => {
    expect(
      buildTextMessage("$", {
        emojis: [{ emojiId: "001", index: 0, productId: PRODUCT_ID }],
        quoteToken: "qt",
      })
    ).toMatchObject({ quoteToken: "qt", type: "textV2" });
  });

  it("escapes literal braces around an emoji", () => {
    expect(
      buildTextMessage("{a} $ {b}", {
        emojis: [{ emojiId: "001", index: 4, productId: PRODUCT_ID }],
      })
    ).toMatchObject({ text: "{{a}} {emoji0} {{b}}" });
  });

  it("rejects an emoji overlapping a mention", () => {
    expect(() =>
      buildTextMessage("@Alice$", {
        emojis: [{ emojiId: "001", index: 5, productId: PRODUCT_ID }],
        mentions: [{ index: 0, length: 6, userId: "U1" }],
      })
    ).toThrow(/must line up with a "\$"/);
  });

  it("rejects two emoji at the same index", () => {
    expect(() =>
      buildTextMessage("Hello $", {
        emojis: [
          { emojiId: "001", index: 6, productId: PRODUCT_ID },
          { emojiId: "002", index: 6, productId: PRODUCT_ID },
        ],
      })
    ).toThrow(/overlap/);
  });

  it("rejects a mention covering the $ an emoji claims", () => {
    expect(() =>
      buildTextMessage("$@Alice", {
        emojis: [{ emojiId: "001", index: 0, productId: PRODUCT_ID }],
        mentions: [{ index: 0, length: 7, userId: "U1" }],
      })
    ).toThrow(/overlap/);
  });

  it("rejects more substitutions than LINE accepts", () => {
    const count = MAX_SUBSTITUTIONS_PER_MESSAGE + 1;
    expect(() =>
      buildTextMessage("$".repeat(count), {
        emojis: Array.from({ length: count }, (_, index) => ({
          emojiId: "001",
          index,
          productId: PRODUCT_ID,
        })),
      })
    ).toThrow(ValidationError);
  });
});
