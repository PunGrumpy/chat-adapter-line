import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import { buildAudioMessage, buildMediaMessage } from "../../src/lib/media.js";

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
