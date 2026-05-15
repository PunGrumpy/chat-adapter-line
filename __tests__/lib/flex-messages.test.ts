import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFlexMessage,
  serializePostbackData,
  deserializePostbackData,
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
      const card: unknown = {
        props: {
          children: [
            {
              props: {
                children: "Hello World",
              },
              type: "CardText",
            },
            {
              props: {
                children: [
                  {
                    props: {
                      children: "Click Me",
                      id: "btn-1",
                      style: "primary",
                      value: "val-1",
                    },
                    type: "Button",
                  },
                ],
              },
              type: "Actions",
            },
          ],
          title: "My Title",
        },
        type: "Card",
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
});
