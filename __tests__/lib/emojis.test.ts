import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  normalizeEmojiSegments,
  parseInboundEmojis,
} from "../../src/lib/emojis.js";
import type { LineMessageEvent } from "../../src/types.js";

const PRODUCT_ID = "5ac1bfd5040ab15980c9b435";

const textMessage = (
  overrides: Partial<LineMessageEvent["message"]> = {}
): LineMessageEvent["message"] => ({
  id: "msg-1",
  text: "Good morning (love)",
  type: "text",
  ...overrides,
});

describe("parseInboundEmojis", () => {
  it("returns an empty array when the message carries no emoji", () => {
    expect(parseInboundEmojis(textMessage())).toEqual([]);
  });

  it("reads the position and identifiers of each emoji", () => {
    const emojis = parseInboundEmojis(
      textMessage({
        emojis: [
          { emojiId: "001", index: 13, length: 6, productId: PRODUCT_ID },
          { emojiId: "002", index: 20, length: 7, productId: PRODUCT_ID },
        ],
      })
    );

    expect(emojis).toEqual([
      { emojiId: "001", index: 13, length: 6, productId: PRODUCT_ID },
      { emojiId: "002", index: 20, length: 7, productId: PRODUCT_ID },
    ]);
  });

  it("returns an empty array when emojis is not an array", () => {
    expect(
      parseInboundEmojis(textMessage({ emojis: "(love)" as never }))
    ).toEqual([]);
  });

  it.each([
    ["a missing index", { emojiId: "001", length: 6, productId: PRODUCT_ID }],
    [
      "a negative index",
      { emojiId: "001", index: -1, length: 6, productId: PRODUCT_ID },
    ],
    [
      "a fractional index",
      { emojiId: "001", index: 1.5, length: 6, productId: PRODUCT_ID },
    ],
    [
      "a zero length",
      { emojiId: "001", index: 13, length: 0, productId: PRODUCT_ID },
    ],
    [
      "an empty productId",
      { emojiId: "001", index: 13, length: 6, productId: "" },
    ],
    ["a missing emojiId", { index: 13, length: 6, productId: PRODUCT_ID }],
    ["a non-object entry", "(love)"],
  ])("drops an entry with %s but keeps the valid ones", (_label, bad) => {
    const emojis = parseInboundEmojis(
      textMessage({
        emojis: [
          bad,
          { emojiId: "002", index: 20, length: 7, productId: PRODUCT_ID },
        ] as never,
      })
    );

    expect(emojis).toEqual([
      { emojiId: "002", index: 20, length: 7, productId: PRODUCT_ID },
    ]);
  });
});

describe("normalizeEmojiSegments", () => {
  it("sorts segments by index", () => {
    const segments = normalizeEmojiSegments("a $ b $", [
      { emojiId: "002", index: 6, productId: PRODUCT_ID },
      { emojiId: "001", index: 2, productId: PRODUCT_ID },
    ]);

    expect(segments.map((segment) => segment.index)).toEqual([2, 6]);
  });

  it("accepts an empty list", () => {
    expect(normalizeEmojiSegments("hi", [])).toEqual([]);
  });

  it.each([
    ["a negative index", { emojiId: "001", index: -1, productId: PRODUCT_ID }],
    [
      "a fractional index",
      { emojiId: "001", index: 0.5, productId: PRODUCT_ID },
    ],
    [
      "an index past the text",
      { emojiId: "001", index: 99, productId: PRODUCT_ID },
    ],
    ["an empty productId", { emojiId: "001", index: 6, productId: "" }],
    ["an empty emojiId", { emojiId: "", index: 6, productId: PRODUCT_ID }],
  ])("rejects %s", (_label, segment) => {
    expect(() => normalizeEmojiSegments("Hello $", [segment])).toThrow(
      ValidationError
    );
  });

  it("rejects an index that does not line up with a $", () => {
    expect(() =>
      normalizeEmojiSegments("Hello $", [
        { emojiId: "001", index: 0, productId: PRODUCT_ID },
      ])
    ).toThrow(/must line up with a "\$"/);
  });
});
