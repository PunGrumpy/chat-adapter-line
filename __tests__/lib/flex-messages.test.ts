import { ValidationError } from "@chat-adapter/shared";
import type { CardElement } from "chat";
import { emoji } from "chat";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFlexMessage,
  buildNativeFlexMessage,
  deserializePostbackData,
  serializePostbackData,
} from "../../src/lib/flex-messages.js";

const cardWithButton = (label: string): CardElement => ({
  children: [
    { children: [{ id: "btn-1", label, type: "button" }], type: "actions" },
  ],
  title: "Pick one",
  type: "card",
});

const footerAction = (
  card: CardElement
): { displayText: string; label: string } | undefined => {
  const contents = buildFlexMessage(card).contents as unknown as {
    footer: {
      contents: { action: { displayText: string; label: string } }[];
    };
  };
  return contents.footer.contents[0]?.action;
};

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

    it("renders the Chat SDK's emoji placeholders as Unicode emoji", () => {
      const card: CardElement = {
        children: [
          { content: `${emoji.fire} on fire`, type: "text" },
          {
            children: [{ content: `${emoji.eyes} details`, type: "text" }],
            type: "section",
          },
          {
            children: [
              {
                id: "btn-1",
                label: `${emoji.thumbs_up} Approve`,
                type: "button",
              },
            ],
            type: "actions",
          },
        ],
        title: `${emoji.wave} Welcome`,
        type: "card",
      };

      const flexMessage = buildFlexMessage(card);
      const contents = flexMessage.contents as unknown as {
        body: { contents: { text: string }[] };
        footer: {
          contents: { action: { displayText: string; label: string } }[];
        };
      };

      expect(flexMessage.altText).toBe("👋 Welcome");
      expect(contents.body.contents.map((item) => item.text)).toEqual([
        "👋 Welcome",
        "🔥 on fire",
        "👀 details",
      ]);
      expect(contents.footer.contents[0]?.action).toMatchObject({
        displayText: "👍 Approve",
        label: "👍 Approve",
      });
    });

    it("keeps a 30 character button label whole", () => {
      const label = "a".repeat(30);

      expect(footerAction(cardWithButton(label))).toMatchObject({
        displayText: label,
        label,
      });
    });

    it("cuts a button label at LINE's 40 character limit", () => {
      expect(footerAction(cardWithButton("a".repeat(45)))?.label).toBe(
        "a".repeat(40)
      );
    });

    it("never leaves half an emoji at the end of a button label", () => {
      const label = `${"a".repeat(19)}${"👍".repeat(30)}`;

      expect(footerAction(cardWithButton(label))?.label).toBe(
        `${"a".repeat(19)}${"👍".repeat(21)}`
      );
    });

    it("counts a Thai letter with its vowel and tone mark as one character", () => {
      const twentyFive = "กี่".repeat(25);

      expect(footerAction(cardWithButton(twentyFive))).toMatchObject({
        displayText: twentyFive,
        label: twentyFive,
      });
      expect(footerAction(cardWithButton("กี่".repeat(45)))?.label).toBe(
        "กี่".repeat(40)
      );
    });

    it("cuts the postback displayText at LINE's 300 character limit", () => {
      expect(footerAction(cardWithButton("a".repeat(350)))?.displayText).toBe(
        "a".repeat(300)
      );
    });

    it("counts displayText in characters, not UTF-16 code units", () => {
      expect(footerAction(cardWithButton("👍".repeat(350)))?.displayText).toBe(
        "👍".repeat(300)
      );
    });

    it("cuts a long card title to LINE's 1500 character altText limit", () => {
      const flexMessage = buildFlexMessage({
        children: [],
        title: "a".repeat(2000),
        type: "card",
      });

      expect(flexMessage.altText).toBe("a".repeat(1500));
    });

    it("never leaves half an emoji at the end of the altText", () => {
      const flexMessage = buildFlexMessage({
        children: [],
        title: `${"a".repeat(1499)}${"👍".repeat(10)}`,
        type: "card",
      });

      expect(flexMessage.altText).toBe("a".repeat(1499));
    });

    it("leaves a caller-built Flex payload's placeholders alone", () => {
      const flex = {
        altText: `${emoji.wave} hi`,
        contents: {
          body: {
            contents: [{ text: `${emoji.wave} hi`, type: "text" }],
            layout: "vertical",
            type: "box",
          },
          type: "bubble",
        },
      };

      expect(buildNativeFlexMessage(flex)).toMatchObject({
        altText: "{{emoji:wave}} hi",
      });
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

    it("rejects an altText longer than LINE's 1500 characters", () => {
      expect(() =>
        buildNativeFlexMessage({ altText: "a".repeat(1501), contents: bubble })
      ).toThrow(/at most 1500/);
      expect(() =>
        buildNativeFlexMessage({ altText: "a".repeat(1500), contents: bubble })
      ).not.toThrow();
    });

    it("counts altText in UTF-16 code units, as LINE does", () => {
      expect(() =>
        buildNativeFlexMessage({
          altText: "👍".repeat(750),
          contents: bubble,
        })
      ).not.toThrow();
      expect(() =>
        buildNativeFlexMessage({
          altText: "👍".repeat(751),
          contents: bubble,
        })
      ).toThrow(ValidationError);
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
