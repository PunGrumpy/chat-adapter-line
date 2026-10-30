import { describe, expect, it } from "vite-plus/test";

import {
  lastGraphemeBoundary,
  truncateGraphemes,
} from "../../src/lib/graphemes.js";

const FAMILY = "👨‍👩‍👧";

describe("lastGraphemeBoundary", () => {
  it("returns the limit for text made of single-unit characters", () => {
    expect(lastGraphemeBoundary("abcdefghij", 4)).toBe(4);
  });

  it("returns the text length when the text fits within the limit", () => {
    expect(lastGraphemeBoundary("abc", 10)).toBe(3);
    expect(lastGraphemeBoundary("abc", 3)).toBe(3);
  });

  it("moves back before a Thai letter that carries a vowel and tone mark", () => {
    const text = `${"ก".repeat(3)}กี่`;

    expect(lastGraphemeBoundary(text, 4)).toBe(3);
    expect(lastGraphemeBoundary(text, 5)).toBe(3);
  });

  it("moves back before a joined emoji sequence the limit falls inside", () => {
    const text = `a${FAMILY}b`;

    expect(lastGraphemeBoundary(text, 5)).toBe(1);
    expect(lastGraphemeBoundary(text, 1 + FAMILY.length)).toBe(
      1 + FAMILY.length
    );
  });

  it("returns 0 when the first cluster is longer than the limit", () => {
    expect(lastGraphemeBoundary(`${FAMILY}b`, 4)).toBe(0);
  });
});

describe("truncateGraphemes", () => {
  it("keeps the first characters of text made of single-unit characters", () => {
    expect(truncateGraphemes("abcdefghij", 4)).toBe("abcd");
  });

  it("returns text that fits within the limit unchanged", () => {
    expect(truncateGraphemes("abc", 3)).toBe("abc");
    expect(truncateGraphemes("abc", 10)).toBe("abc");
    expect(truncateGraphemes("", 5)).toBe("");
  });

  it("counts a Thai letter with its vowel and tone mark as one character", () => {
    expect(truncateGraphemes("กี่".repeat(5), 2)).toBe("กี่กี่");
  });

  it("counts a joined emoji sequence as one character", () => {
    expect(truncateGraphemes(`${FAMILY}${FAMILY}${FAMILY}`, 2)).toBe(
      `${FAMILY}${FAMILY}`
    );
  });

  it("counts a surrogate-pair emoji as one character", () => {
    expect(truncateGraphemes("👍".repeat(5), 3)).toBe("👍👍👍");
  });

  it("returns an empty string for a limit of 0", () => {
    expect(truncateGraphemes("abc", 0)).toBe("");
  });
});
