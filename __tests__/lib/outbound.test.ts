import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import { LineFormatConverter } from "../../src/lib/format-converter.js";
import {
  MAX_MESSAGES_PER_REQUEST,
  MAX_MULTICAST_RECIPIENTS,
  linePostable,
  toBatchLineMessages,
  toLineMessages,
  validateAggregationUnits,
  validateMulticastRecipients,
  validateRetryKey,
} from "../../src/lib/outbound.js";

const converter = new LineFormatConverter();

describe("toLineMessages", () => {
  it("converts a string to a text message", () => {
    expect(toLineMessages("hi", converter)).toEqual([
      { text: "hi", type: "text" },
    ]);
  });

  it("converts raw, markdown, and ast postables to text", () => {
    expect(toLineMessages({ raw: "r" }, converter)).toEqual([
      { text: "r", type: "text" },
    ]);
    expect(toLineMessages({ markdown: "**m**" }, converter)).toEqual([
      { text: "m", type: "text" },
    ]);
    expect(
      toLineMessages(
        {
          ast: {
            children: [
              {
                children: [{ type: "text", value: "a" }],
                type: "paragraph",
              },
            ],
            type: "root",
          },
        },
        converter
      )
    ).toEqual([{ text: "a", type: "text" }]);
  });

  it("converts a card to a flex message", () => {
    const [message] = toLineMessages(
      { card: { children: [], title: "Card", type: "card" } },
      converter
    );

    expect(message).toMatchObject({ altText: "Card", type: "flex" });
  });

  it("converts audio to a native audio message", () => {
    expect(
      toLineMessages(
        {
          audio: {
            duration: 5000,
            originalContentUrl: "https://cdn.example.com/a.m4a",
          },
        },
        converter
      )
    ).toEqual([
      {
        duration: 5000,
        originalContentUrl: "https://cdn.example.com/a.m4a",
        type: "audio",
      },
    ]);
  });

  it("rejects an audio URL longer than 2000 characters", () => {
    const originalContentUrl = `https://example.com/${"a".repeat(2000)}`;

    expect(() =>
      toLineMessages({ audio: { duration: 1, originalContentUrl } }, converter)
    ).toThrow(/2000 characters/);
  });

  it("rejects audio that is not an object", () => {
    expect(() =>
      toLineMessages({ audio: "https://x" } as never, converter)
    ).toThrow(ValidationError);
  });

  it("throws when there is no content", () => {
    expect(() => toLineMessages({} as never, converter)).toThrow(
      ValidationError
    );
    expect(() => toLineMessages(null as never, converter)).toThrow(
      ValidationError
    );
  });
});

describe("toBatchLineMessages", () => {
  it("wraps a single postable", () => {
    expect(toBatchLineMessages("hi", converter)).toEqual([
      { text: "hi", type: "text" },
    ]);
  });

  it("flattens several postables in order", () => {
    expect(toBatchLineMessages(["a", { raw: "b" }], converter)).toEqual([
      { text: "a", type: "text" },
      { text: "b", type: "text" },
    ]);
  });

  it("accepts exactly the per-request limit", () => {
    const postables = Array.from(
      { length: MAX_MESSAGES_PER_REQUEST },
      () => "x"
    );

    expect(toBatchLineMessages(postables, converter)).toHaveLength(
      MAX_MESSAGES_PER_REQUEST
    );
  });

  it("rejects more than the per-request limit", () => {
    const postables = Array.from(
      { length: MAX_MESSAGES_PER_REQUEST + 1 },
      () => "x"
    );

    expect(() => toBatchLineMessages(postables, converter)).toThrow(
      ValidationError
    );
  });

  it("rejects an empty list", () => {
    expect(() => toBatchLineMessages([], converter)).toThrow(ValidationError);
  });
});

describe("validateAggregationUnits", () => {
  it("accepts undefined, an empty list, and one short unit", () => {
    expect(() => validateAggregationUnits()).not.toThrow();
    expect(() => validateAggregationUnits([])).not.toThrow();
    expect(() => validateAggregationUnits(["promo_a"])).not.toThrow();
    expect(() => validateAggregationUnits(["x".repeat(30)])).not.toThrow();
  });

  it("rejects more than one unit or an invalid name", () => {
    expect(() => validateAggregationUnits(["a", "b"])).toThrow(ValidationError);
    expect(() => validateAggregationUnits(["x".repeat(31)])).toThrow(
      ValidationError
    );
    expect(() => validateAggregationUnits([""])).toThrow(ValidationError);
    expect(() => validateAggregationUnits(["promo-a"])).toThrow(
      ValidationError
    );
  });
});

describe("validateRetryKey", () => {
  it("accepts undefined and UUIDs", () => {
    expect(() => validateRetryKey()).not.toThrow();
    expect(() =>
      validateRetryKey("123E4567-E89B-12D3-A456-426614174000")
    ).not.toThrow();
  });

  it("rejects non-UUID strings", () => {
    expect(() => validateRetryKey("")).toThrow(ValidationError);
    expect(() => validateRetryKey("abc")).toThrow(ValidationError);
    expect(() => validateRetryKey("123e4567e89b12d3a456426614174000")).toThrow(
      ValidationError
    );
  });
});

describe("validateMulticastRecipients", () => {
  const userId = `U${"0".repeat(32)}`;

  it("accepts well-formed user IDs up to the limit", () => {
    expect(() => validateMulticastRecipients([userId])).not.toThrow();
    expect(() =>
      validateMulticastRecipients(
        Array.from({ length: MAX_MULTICAST_RECIPIENTS }, () => userId)
      )
    ).not.toThrow();
  });

  it("rejects empty, oversized, and malformed lists", () => {
    expect(() => validateMulticastRecipients([])).toThrow(ValidationError);
    expect(() =>
      validateMulticastRecipients(
        Array.from({ length: MAX_MULTICAST_RECIPIENTS + 1 }, () => userId)
      )
    ).toThrow(ValidationError);
    expect(() => validateMulticastRecipients(["U123"])).toThrow(
      ValidationError
    );
    expect(() => validateMulticastRecipients([`u${"0".repeat(32)}`])).toThrow(
      ValidationError
    );
    expect(() => validateMulticastRecipients([userId, "" as never])).toThrow(
      ValidationError
    );
  });
});

describe("linePostable", () => {
  it("returns the same object so the adapter sees the LINE fields", () => {
    const postable = {
      audio: { duration: 1, originalContentUrl: "https://x/a.m4a" },
    };

    expect(linePostable(postable)).toBe(postable);
  });
});
