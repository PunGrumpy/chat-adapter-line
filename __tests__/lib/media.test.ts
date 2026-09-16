import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  buildAudioMessage,
  buildMediaMessage,
  parseInboundMedia,
} from "../../src/lib/media.js";
import type { LineMessageEvent } from "../../src/types.js";

const ORIGINAL = "https://example.com/original.mp4";
const PREVIEW = "https://example.com/preview.jpg";

describe("buildAudioMessage", () => {
  it("builds a native audio message", () => {
    expect(
      buildAudioMessage({ duration: 12_000, originalContentUrl: ORIGINAL })
    ).toEqual({
      duration: 12_000,
      originalContentUrl: ORIGINAL,
      type: "audio",
    });
  });

  it.each([
    ["a non-object", "https://example.com/a.m4a"],
    ["an http URL", { duration: 1, originalContentUrl: "http://x/a.m4a" }],
    ["an empty URL", { duration: 1, originalContentUrl: "" }],
    ["a zero duration", { duration: 0, originalContentUrl: ORIGINAL }],
    ["a fractional duration", { duration: 1.5, originalContentUrl: ORIGINAL }],
  ])("rejects %s", (_label, audio) => {
    expect(() => buildAudioMessage(audio)).toThrow(ValidationError);
  });
});

describe("buildMediaMessage", () => {
  it.each(["image", "video"] as const)("builds a native %s message", (type) => {
    expect(
      buildMediaMessage(
        { originalContentUrl: ORIGINAL, previewImageUrl: PREVIEW },
        type
      )
    ).toEqual({
      originalContentUrl: ORIGINAL,
      previewImageUrl: PREVIEW,
      type,
    });
  });

  it.each([
    ["a non-object", ORIGINAL],
    ["a missing originalContentUrl", { previewImageUrl: PREVIEW }],
    ["a missing previewImageUrl", { originalContentUrl: ORIGINAL }],
    [
      "an http originalContentUrl",
      {
        originalContentUrl: "http://example.com/o.jpg",
        previewImageUrl: PREVIEW,
      },
    ],
    [
      "an http previewImageUrl",
      {
        originalContentUrl: ORIGINAL,
        previewImageUrl: "http://example.com/p.jpg",
      },
    ],
    [
      "an empty previewImageUrl",
      { originalContentUrl: ORIGINAL, previewImageUrl: "" },
    ],
    [
      "a non-URL originalContentUrl",
      { originalContentUrl: "not a url", previewImageUrl: PREVIEW },
    ],
    [
      "a non-string previewImageUrl",
      { originalContentUrl: ORIGINAL, previewImageUrl: 42 },
    ],
  ])("rejects %s", (_label, media) => {
    expect(() => buildMediaMessage(media, "image")).toThrow(ValidationError);
  });

  it.each([
    [
      "originalContentUrl",
      {
        originalContentUrl: `https://x/${"a".repeat(2000)}`,
        previewImageUrl: PREVIEW,
      },
    ],
    [
      "previewImageUrl",
      {
        originalContentUrl: ORIGINAL,
        previewImageUrl: `https://x/${"a".repeat(2000)}`,
      },
    ],
  ])("rejects a %s longer than 2000 characters", (_label, media) => {
    expect(() => buildMediaMessage(media, "video")).toThrow(/2000 characters/);
  });

  it("names the failing field for the type it was given", () => {
    expect(() =>
      buildMediaMessage({ previewImageUrl: PREVIEW }, "video")
    ).toThrow(/video\.originalContentUrl/);
  });
});

type RawMessage = LineMessageEvent["message"];

const mediaMessage = (overrides: Partial<RawMessage> = {}): RawMessage =>
  ({ id: "img-1", type: "image", ...overrides }) as RawMessage;

describe("parseInboundMedia", () => {
  it.each(["image", "video", "audio", "file"] as const)(
    "reports the ID and kind of a %s message",
    (kind) => {
      expect(
        parseInboundMedia(mediaMessage({ id: "m-1", type: kind }))
      ).toEqual({ kind, providerMessageId: "m-1" });
    }
  );

  it.each([
    ["text", { id: "msg-1", text: "hi", type: "text" as const }],
    ["location", { id: "loc-1", type: "location" as const }],
    ["sticker", { id: "stk-1", type: "sticker" as const }],
  ])("returns undefined for a %s message", (_label, message) => {
    expect(parseInboundMedia(message as RawMessage)).toBeUndefined();
  });

  it("returns undefined for a media message with no ID", () => {
    expect(parseInboundMedia(mediaMessage({ id: "" }))).toBeUndefined();
  });

  it("keeps the name and size of a file", () => {
    expect(
      parseInboundMedia(
        mediaMessage({
          fileName: "report.pdf",
          fileSize: 138_024,
          id: "file-1",
          type: "file",
        })
      )
    ).toEqual({
      fileName: "report.pdf",
      fileSize: 138_024,
      kind: "file",
      providerMessageId: "file-1",
    });
  });

  it("accepts a zero-byte file", () => {
    expect(
      parseInboundMedia(
        mediaMessage({ fileSize: 0, id: "file-1", type: "file" })
      )?.fileSize
    ).toBe(0);
  });

  it.each(["audio", "video"] as const)("keeps the duration of %s", (kind) => {
    expect(
      parseInboundMedia(
        mediaMessage({ duration: 60_000, id: "m-1", type: kind })
      )?.duration
    ).toBe(60_000);
  });

  it("keeps a LINE content provider", () => {
    expect(
      parseInboundMedia(mediaMessage({ contentProvider: { type: "line" } }))
        ?.contentProvider
    ).toEqual({ type: "line" });
  });

  it("keeps an external content provider and its URLs", () => {
    expect(
      parseInboundMedia(
        mediaMessage({
          contentProvider: {
            originalContentUrl: "https://example.com/original.jpg",
            previewImageUrl: "https://example.com/preview.jpg",
            type: "external",
          },
        })
      )?.contentProvider
    ).toEqual({
      originalContentUrl: "https://example.com/original.jpg",
      previewImageUrl: "https://example.com/preview.jpg",
      type: "external",
    });
  });

  it.each([
    ["an empty fileName", { fileName: "" }],
    ["a non-string fileName", { fileName: 42 }],
    ["a negative fileSize", { fileSize: -1 }],
    ["a fractional fileSize", { fileSize: 1.5 }],
    ["a NaN fileSize", { fileSize: Number.NaN }],
    ["a zero duration", { duration: 0 }],
    ["a negative duration", { duration: -1 }],
    ["an infinite duration", { duration: Number.POSITIVE_INFINITY }],
    ["a provider of an unknown type", { contentProvider: { type: "s3" } }],
    ["a provider that is not an object", { contentProvider: "line" }],
  ])("drops %s but keeps the attachment", (_label, overrides) => {
    expect(parseInboundMedia(mediaMessage(overrides as never))).toEqual({
      kind: "image",
      providerMessageId: "img-1",
    });
  });

  it("drops only the unusable URL of a provider", () => {
    expect(
      parseInboundMedia(
        mediaMessage({
          contentProvider: {
            originalContentUrl: "https://example.com/original.jpg",
            previewImageUrl: "",
            type: "external",
          },
        })
      )?.contentProvider
    ).toEqual({
      originalContentUrl: "https://example.com/original.jpg",
      type: "external",
    });
  });
});
