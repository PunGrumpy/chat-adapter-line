const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export const lastGraphemeBoundary = (text: string, limit: number): number => {
  if (text.length <= limit) {
    return text.length;
  }

  let boundary = 0;
  for (const { index } of graphemeSegmenter.segment(text)) {
    if (index > limit) {
      break;
    }
    boundary = index;
  }
  return boundary;
};

export const truncateGraphemes = (
  text: string,
  maxGraphemes: number
): string => {
  let count = 0;
  for (const { index } of graphemeSegmenter.segment(text)) {
    if (count === maxGraphemes) {
      return text.slice(0, index);
    }
    count += 1;
  }
  return text;
};
