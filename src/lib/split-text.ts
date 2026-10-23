const SEPARATORS = ["\n\n", "\n", " "] as const;

const MAX_SINGLE_UNIT_CODE_POINT = 65_535;

interface Break {
  end: number;
  nextStart: number;
}

const startsSurrogatePair = (text: string, index: number): boolean =>
  (text.codePointAt(index) ?? 0) > MAX_SINGLE_UNIT_CODE_POINT;

const findBreak = (text: string, limit: number): Break => {
  const minPartLength = limit / 2;

  for (const separator of SEPARATORS) {
    const index = text.lastIndexOf(separator, limit);
    if (index >= minPartLength) {
      return { end: index, nextStart: index + separator.length };
    }
  }

  const end =
    limit > 1 && startsSurrogatePair(text, limit - 1) ? limit - 1 : limit;
  return { end, nextStart: end };
};

export const splitText = (text: string, limit: number): string[] => {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const { end, nextStart } = findBreak(rest, limit);
    parts.push(rest.slice(0, end));
    rest = rest.slice(nextStart);
  }

  parts.push(rest);
  return parts.filter((part) => part.trim() !== "");
};
