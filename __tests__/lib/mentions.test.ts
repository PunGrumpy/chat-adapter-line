import { describe, expect, it } from "vite-plus/test";

import { parseInboundMentions } from "../../src/lib/mentions.js";
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
