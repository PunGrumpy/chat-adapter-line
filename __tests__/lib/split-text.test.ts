import { describe, expect, it } from "vite-plus/test";

import { splitText } from "../../src/lib/split-text.js";

describe("splitText", () => {
  it("returns text within the limit as one part", () => {
    expect(splitText("hello", 10)).toEqual(["hello"]);
  });

  it("returns no parts for empty or blank text", () => {
    expect(splitText("", 10)).toEqual([]);
    expect(splitText("   ", 10)).toEqual([]);
  });

  it("breaks at a paragraph break", () => {
    expect(splitText("aaaaaa\n\nbbbbbb", 10)).toEqual(["aaaaaa", "bbbbbb"]);
  });

  it("prefers a paragraph break over a later line break", () => {
    expect(splitText("aaaaaa\n\nbb\ncc", 12)).toEqual(["aaaaaa", "bb\ncc"]);
  });

  it("falls back to a line break", () => {
    expect(splitText("aaaaaaa\nbbbbbbb", 10)).toEqual(["aaaaaaa", "bbbbbbb"]);
  });

  it("falls back to a space", () => {
    expect(splitText("aaaa bbbb cccc", 10)).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("ignores a separator in the front half of the window", () => {
    expect(splitText("a bbbbbbbbbbbb", 10)).toEqual(["a bbbbbbbb", "bbbb"]);
  });

  it("cuts hard when there is no separator", () => {
    expect(splitText("x".repeat(25), 10)).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "x".repeat(5),
    ]);
  });

  it("never splits a surrogate pair", () => {
    expect(splitText(`${"a".repeat(9)}😀b`, 10)).toEqual([
      "a".repeat(9),
      "😀b",
    ]);
  });

  it("keeps every part within the limit and loses only separators", () => {
    const text = "word ".repeat(3000);
    const parts = splitText(text, 5000);

    expect(parts.length).toBeGreaterThan(1);
    expect(Math.max(...parts.map((part) => part.length))).toBeLessThanOrEqual(
      5000
    );
    expect(parts.join(" ")).toBe(text);
  });
});
