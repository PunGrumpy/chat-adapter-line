import { ValidationError } from "@chat-adapter/shared";
import type { CardElement } from "chat";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFlexMessage,
  buildNativeFlexMessage,
  deserializePostbackData,
  serializePostbackData,
} from "../../src/lib/flex-messages.js";

describe("Flex Messages Utility", () => {
  describe("Postback Data Serialization", () => {
    it("should serialize id and value correctly", () => {
      const result = serializePostbackData("btn-1", "val-1");
      expect(result).toBe("id=btn-1&v=val-1");
    });

    it("should serialize id only", () => {
      const result = serializePostbackData("btn-1");
      expect(result).toBe("id=btn-1");
    });

    it("should throw ValidationError if length exceeds 300 chars", () => {
      const longValue = "a".repeat(300);
      expect(() => serializePostbackData("btn-1", longValue)).toThrowError(
        ValidationError
      );
    });
  });

  describe("Postback Data Deserialization", () => {
    it("should deserialize id and value correctly", () => {
      const result = deserializePostbackData("id=btn-1&v=val-1");
      expect(result).toEqual({ id: "btn-1", value: "val-1" });
    });

    it("should deserialize id only", () => {
      const result = deserializePostbackData("id=btn-1");
      expect(result).toEqual({ id: "btn-1", value: undefined });
    });

    it("should return null for invalid data", () => {
      const result = deserializePostbackData("v=val-1");
      expect(result).toBeNull();
    });
  });

  describe("buildFlexMessage", () => {
    it("should convert a basic Card to Flex Message", () => {
      const card: CardElement = {
        children: [
          { content: "Hello World", type: "text" },
          {
            children: [
              {
                id: "btn-1",
                label: "Click Me",
                style: "primary",
                type: "button",
                value: "val-1",
              },
            ],
            type: "actions",
          },
        ],
        title: "My Title",
        type: "card",
      };

      const flexMessage = buildFlexMessage(card);
      expect(flexMessage.type).toBe("flex");
      expect(flexMessage.altText).toBe("My Title");

      const contents = flexMessage.contents as unknown as {
        type: string;
        body: { contents: unknown[] };
        footer: { contents: unknown[] };
      };

      expect(contents.type).toBe("bubble");
      expect(contents.body.contents.length).toBe(2);
      expect((contents.body.contents[0] as { text: string }).text).toBe(
        "My Title"
      );
      expect((contents.body.contents[1] as { text: string }).text).toBe(
        "Hello World"
      );

      expect(contents.footer.contents.length).toBe(1);
      expect(
        (contents.footer.contents[0] as { action: { data: string } }).action
          .data
      ).toBe("id=btn-1&v=val-1");
    });
  });
  describe("buildNativeFlexMessage", () => {
    const bubble = {
      body: {
        contents: [{ text: "Hello", type: "text" }],
        layout: "vertical",
        type: "box",
      },
      hero: {
        aspectRatio: "20:13",
        size: "full",
        type: "image",
        url: "https://example.com/hero.png",
      },
      type: "bubble",
    };

    it("wraps a bubble container without touching its contents", () => {
      const message = buildNativeFlexMessage({
        altText: "A bubble",
        contents: bubble,
      });

      expect(message).toEqual({
        altText: "A bubble",
        contents: bubble,
        type: "flex",
      });
      expect(message.contents).toBe(bubble);
    });

    it("wraps a carousel container", () => {
      const carousel = { contents: [bubble, bubble], type: "carousel" };

      const message = buildNativeFlexMessage({
        altText: "Two bubbles",
        contents: carousel,
      });

      expect(message).toEqual({
        altText: "Two bubbles",
        contents: carousel,
        type: "flex",
      });
    });

    it("rejects a missing, empty, or whitespace-only altText", () => {
      expect(() => buildNativeFlexMessage({ contents: bubble })).toThrow(
        ValidationError
      );
      expect(() =>
        buildNativeFlexMessage({ altText: "", contents: bubble })
      ).toThrow(ValidationError);
      expect(() =>
        buildNativeFlexMessage({ altText: "   ", contents: bubble })
      ).toThrow(ValidationError);
      expect(() =>
        buildNativeFlexMessage({ altText: 42, contents: bubble })
      ).toThrow(ValidationError);
    });

    it("rejects an altText longer than 400 characters", () => {
      expect(() =>
        buildNativeFlexMessage({ altText: "a".repeat(401), contents: bubble })
      ).toThrow(ValidationError);
      expect(() =>
        buildNativeFlexMessage({ altText: "a".repeat(400), contents: bubble })
      ).not.toThrow();
    });

    it("rejects contents that are not a bubble or carousel", () => {
      expect(() => buildNativeFlexMessage({ altText: "x" })).toThrow(
        ValidationError
      );
      expect(() =>
        buildNativeFlexMessage({ altText: "x", contents: "bubble" })
      ).toThrow(ValidationError);
      expect(() =>
        buildNativeFlexMessage({
          altText: "x",
          contents: { layout: "vertical", type: "box" },
        })
      ).toThrow(ValidationError);
    });

    it("rejects a flex payload that is not an object", () => {
      expect(() => buildNativeFlexMessage("bubble")).toThrow(ValidationError);
      expect(() => buildNativeFlexMessage(null)).toThrow(ValidationError);
    });
  });
});
