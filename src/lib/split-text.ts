/** Break points to try, best first: a paragraph break, a line break, a space. */
const SEPARATORS = ["\n\n", "\n", " "] as const;

/** The largest code point a single UTF-16 code unit can hold (0xFFFF). */
const MAX_SINGLE_UNIT_CODE_POINT = 65_535;

interface Break {
  /** Where the current part ends. */
  end: number;
  /** Where the next part starts, past the separator the text breaks at. */
  next: number;
}

/**
 * Finds where to end a part of `text` that is at most `limit` code units
 * long. A separator only counts in the back half of the window, so parts stay
 * reasonably full. Without one the cut is hard, but never between the two
 * halves of a surrogate pair.
 */
const findBreak = (text: string, limit: number): Break => {
  for (const separator of SEPARATORS) {
    const index = text.lastIndexOf(separator, limit);
    if (index >= limit / 2) {
      return { end: index, next: index + separator.length };
    }
  }

  const splitsPair =
    limit > 1 &&
    (text.codePointAt(limit - 1) ?? 0) > MAX_SINGLE_UNIT_CODE_POINT;
  const end = splitsPair ? limit - 1 : limit;
  return { end, next: end };
};

/**
 * Splits text into parts of at most `limit` UTF-16 code units, the unit LINE
 * counts message length in. A part ends at a paragraph break, else a line
 * break, else a space, when one falls in the back half of the window, and
 * never inside a surrogate pair. The separator at a break is dropped, and
 * parts holding only whitespace are left out.
 */
export const splitText = (text: string, limit: number): string[] => {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const { end, next } = findBreak(rest, limit);
    parts.push(rest.slice(0, end));
    rest = rest.slice(next);
  }

  parts.push(rest);
  return parts.filter((part) => part.trim() !== "");
};
