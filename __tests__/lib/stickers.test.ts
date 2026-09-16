import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  buildStickerMessage,
  MAX_STICKER_KEYWORDS,
  parseInboundSticker,
} from "../../src/lib/stickers.js";
import type { LineMessageEvent } from "../../src/types.js";

type RawMessage = LineMessageEvent["message"];

const stickerMessage = (overrides: Partial<RawMessage> = {}): RawMessage =>
  ({
    id: "msg-1",
    packageId: "446",
    quoteToken: "qt-1",
    stickerId: "1988",
    stickerResourceType: "STATIC",
    type: "sticker",
    ...overrides,
  }) as RawMessage;

describe("parseInboundSticker", () => {
  it("reads the sticker identity", () => {
    expect(parseInboundSticker(stickerMessage())).toEqual({
      packageId: "446",
      resourceType: "STATIC",
      stickerId: "1988",
    });
  });

  it("returns undefined for a non-sticker message", () => {
    expect(
      parseInboundSticker({ id: "msg-1", text: "hi", type: "text" })
    ).toBeUndefined();
  });

  it.each([
    ["missing packageId", { packageId: undefined }],
    ["missing stickerId", { stickerId: undefined }],
    ["empty packageId", { packageId: "" }],
    ["empty stickerId", { stickerId: "" }],
    ["non-string packageId", { packageId: 446 as never }],
  ])("returns undefined for a sticker with a %s", (_label, overrides) => {
    expect(parseInboundSticker(stickerMessage(overrides))).toBeUndefined();
  });

  it("keeps keywords and the sender's text", () => {
    const sticker = parseInboundSticker(
      stickerMessage({
        keywords: ["thanks", "bow"],
        stickerResourceType: "MESSAGE",
        text: "Thank you!",
      })
    );

    expect(sticker).toEqual({
      keywords: ["thanks", "bow"],
      packageId: "446",
      resourceType: "MESSAGE",
      stickerId: "1988",
      text: "Thank you!",
    });
  });

  it("drops non-string keywords and caps the list", () => {
    const keywords = Array.from(
      { length: MAX_STICKER_KEYWORDS + 3 },
      (_, i) => `k${i}`
    );
    const sticker = parseInboundSticker(
      stickerMessage({ keywords: [1 as never, ...keywords] })
    );

    expect(sticker?.keywords).toHaveLength(MAX_STICKER_KEYWORDS);
    expect(sticker?.keywords?.[0]).toBe("k0");
  });

  it("omits an unknown resource type, empty keywords, and empty text", () => {
    const sticker = parseInboundSticker(
      stickerMessage({
        keywords: [],
        stickerResourceType: "HOLOGRAM" as never,
        text: "",
      })
    );

    expect(sticker).toEqual({ packageId: "446", stickerId: "1988" });
  });
});

describe("buildStickerMessage", () => {
  it("builds a native sticker message", () => {
    expect(
      buildStickerMessage({ packageId: "446", stickerId: "1988" })
    ).toEqual({ packageId: "446", stickerId: "1988", type: "sticker" });
  });

  it("carries a quote token", () => {
    expect(
      buildStickerMessage(
        { packageId: "446", stickerId: "1988" },
        { quoteToken: "qt-1" }
      )
    ).toEqual({
      packageId: "446",
      quoteToken: "qt-1",
      stickerId: "1988",
      type: "sticker",
    });
  });

  it("accepts an inbound sticker unchanged", () => {
    const inbound = parseInboundSticker(
      stickerMessage({ keywords: ["thanks"] })
    );

    expect(buildStickerMessage(inbound)).toEqual({
      packageId: "446",
      stickerId: "1988",
      type: "sticker",
    });
  });

  it.each([
    ["a non-object", "446"],
    ["a missing packageId", { stickerId: "1988" }],
    ["a missing stickerId", { packageId: "446" }],
    ["a non-decimal packageId", { packageId: "pack-446", stickerId: "1988" }],
    ["an empty stickerId", { packageId: "446", stickerId: "" }],
    ["a numeric stickerId", { packageId: "446", stickerId: 1988 }],
  ])("rejects %s", (_label, sticker) => {
    expect(() => buildStickerMessage(sticker)).toThrow(ValidationError);
  });

  it.each(["CUSTOM", "MESSAGE", "NAME_TEXT", "PER_STICKER_TEXT"])(
    "rejects a %s sticker, which LINE renders from sender text",
    (resourceType) => {
      expect(() =>
        buildStickerMessage({
          packageId: "446",
          resourceType,
          stickerId: "1988",
        })
      ).toThrow(ValidationError);
    }
  );

  it("rejects an unknown resource type", () => {
    expect(() =>
      buildStickerMessage({
        packageId: "446",
        resourceType: "HOLOGRAM",
        stickerId: "1988",
      })
    ).toThrow(ValidationError);
  });

  it.each(["STATIC", "ANIMATION", "SOUND", "ANIMATION_SOUND", "POPUP"])(
    "accepts a %s sticker",
    (resourceType) => {
      expect(
        buildStickerMessage({
          packageId: "446",
          resourceType,
          stickerId: "1988",
        })
      ).toMatchObject({ type: "sticker" });
    }
  );
});
