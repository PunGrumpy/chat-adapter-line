import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";
import type { CardElement } from "chat";
import { cardChildToFallbackText } from "chat";

import { renderSdkEmoji } from "./emojis.js";
import { lastGraphemeBoundary, truncateGraphemes } from "./graphemes.js";
import { isNonEmptyString } from "./guards.js";
import { isRecord } from "./is-record.js";
import { readContentUrl } from "./media.js";

const MAX_POSTBACK_DATA_LENGTH = 300;
const MAX_BUTTON_LABEL_GRAPHEMES = 40;
const MAX_ACTION_DISPLAY_TEXT_GRAPHEMES = 300;
const MAX_ALT_TEXT_LENGTH = 1500;
const MAX_URI_LENGTH = 10_000;
const URI_ACTION_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "line:",
  "tel:",
]);
const MUTED_COLOR = "#8C8C8C";
const LINK_COLOR = "#1E6FD9";

/**
 * `chat` 4.17.0's `CardChild` has no chart, so the chart shape is declared
 * here and joined to whichever union the installed `chat` exports.
 */
type CardChildNode = CardElement["children"][number];
type ActionChild = Extract<
  CardChildNode,
  { type: "actions" }
>["children"][number];
type ButtonNode = Extract<ActionChild, { type: "button" }>;
type LinkButtonNode = Extract<ActionChild, { type: "link-button" }>;
type LinkNode = Extract<CardChildNode, { type: "link" }>;
type TableNode = Extract<CardChildNode, { type: "table" }>;
type ColumnAlignment = NonNullable<TableNode["align"]>[number];

interface ChartPoint {
  label: string;
  value: number;
}

interface ChartNode {
  chart:
    | { segments: ChartPoint[]; type: "pie" }
    | {
        categories: string[];
        series: { data: ChartPoint[]; name: string }[];
        type: "area" | "bar" | "line";
        xLabel?: string;
        yLabel?: string;
      };
  title: string;
  type: "chart";
}

type CardNode = CardChildNode | ChartNode;

/** The two bubble blocks a card's children fill. */
interface BubbleBlocks {
  body: messagingApi.FlexComponent[];
  footer: messagingApi.FlexButton[];
}

/**
 * Serializes a button ID and value into a URL-encoded string.
 * Format: id=<id>&v=<value>
 */
export const serializePostbackData = (id: string, value?: string): string => {
  const params = new URLSearchParams();
  params.set("id", id);
  if (value) {
    params.set("v", value);
  }
  const serialized = params.toString();

  if (serialized.length > MAX_POSTBACK_DATA_LENGTH) {
    throw new ValidationError(
      "line",
      `Button data exceeds LINE's ${MAX_POSTBACK_DATA_LENGTH} character limit: ${serialized}`
    );
  }

  return serialized;
};

/**
 * Deserializes a URL-encoded string back into an ID and value.
 * Returns null when the data has no parseable `id` parameter.
 */
export const deserializePostbackData = (
  data: string
): { id: string; value?: string } | null => {
  try {
    const params = new URLSearchParams(data);
    const id = params.get("id");
    if (!id) {
      return null;
    }
    return { id, value: params.get("v") || undefined };
  } catch {
    return null;
  }
};

type FlexTextOptions = Partial<Omit<messagingApi.FlexText, "text" | "type">>;

const toFlexText = (
  text: string,
  options: FlexTextOptions = {}
): messagingApi.FlexText => ({
  text: renderSdkEmoji(text),
  type: "text",
  wrap: true,
  ...options,
});

const MUTED_TEXT: FlexTextOptions = { color: MUTED_COLOR, size: "sm" };

const TEXT_STYLE_OPTIONS: Readonly<Record<string, FlexTextOptions>> = {
  bold: { weight: "bold" },
  muted: MUTED_TEXT,
};

const COLUMN_ALIGNMENT: Readonly<
  Record<ColumnAlignment, messagingApi.FlexText.AlignEnum>
> = { center: "center", left: "start", right: "end" };

/** LINE rejects a text component with empty text, so a filler holds its place. */
const toTextOrFiller = (
  text: string,
  options: FlexTextOptions
): messagingApi.FlexComponent =>
  text === ""
    ? { flex: options.flex ?? 1, type: "filler" }
    : toFlexText(text, options);

const toGridCell = (
  text: string,
  options: FlexTextOptions
): messagingApi.FlexComponent =>
  toTextOrFiller(text, { flex: 1, size: "sm", ...options });

const toGridRow = (
  cells: string[],
  columnCount: number,
  align: ColumnAlignment[] | undefined,
  options: FlexTextOptions = {}
): messagingApi.FlexBox => ({
  contents: Array.from({ length: columnCount }, (_, index) => {
    const alignment = align?.[index];
    return toGridCell(cells[index] ?? "", {
      align: alignment === undefined ? undefined : COLUMN_ALIGNMENT[alignment],
      ...options,
    });
  }),
  layout: "horizontal",
  spacing: "sm",
  type: "box",
});

/** Tabular data and the muted note, a caption or axis label, under it. */
interface Grid {
  align?: ColumnAlignment[];
  headers?: string[];
  note?: string;
  rows: string[][];
}

/**
 * Lays a grid out as rows of equal-width columns. A short row is padded
 * with fillers so its cells stay under their headers.
 */
const toGridComponents = (grid: Grid): messagingApi.FlexComponent[] => {
  const columnCount = Math.max(
    0,
    grid.headers?.length ?? 0,
    ...grid.rows.map((row) => row.length)
  );
  const components: messagingApi.FlexComponent[] = [];

  if (columnCount > 0) {
    const contents: messagingApi.FlexComponent[] = [];
    if (grid.headers) {
      contents.push(
        toGridRow(grid.headers, columnCount, grid.align, { weight: "bold" })
      );
    }
    for (const row of grid.rows) {
      contents.push(toGridRow(row, columnCount, grid.align));
    }
    components.push({
      contents,
      layout: "vertical",
      margin: "md",
      spacing: "sm",
      type: "box",
    });
  }

  if (isNonEmptyString(grid.note)) {
    components.push(toFlexText(grid.note, { ...MUTED_TEXT, margin: "sm" }));
  }

  return components;
};

const readTableCaption = (table: TableNode): string | undefined =>
  "caption" in table && isNonEmptyString(table.caption)
    ? table.caption
    : undefined;

const toChartGrid = (chart: ChartNode["chart"]): Grid => {
  if (chart.type === "pie") {
    const total = chart.segments.reduce((sum, { value }) => sum + value, 0);
    return {
      align: ["left", "right", "right"],
      rows: chart.segments.map(({ label, value }) => [
        label,
        String(value),
        total > 0 ? `${Math.round((value / total) * 100)}%` : "",
      ]),
    };
  }

  return {
    align: ["left", ...chart.series.map((): ColumnAlignment => "right")],
    headers: [chart.xLabel ?? "", ...chart.series.map(({ name }) => name)],
    note: chart.yLabel,
    rows: chart.categories.map((category, index) => [
      category,
      ...chart.series.map(({ data }) => {
        // Categories may repeat, so a point is matched by position first.
        const point =
          data[index]?.label === category
            ? data[index]
            : data.find(({ label }) => label === category);
        return point === undefined ? "" : String(point.value);
      }),
    ]),
  };
};

const protocolOf = (url: string): string | undefined => {
  try {
    return new URL(url).protocol;
  } catch {
    return undefined;
  }
};

const readLinkUrl = (url: string): string => {
  const protocol = protocolOf(url);
  if (protocol === undefined || !URI_ACTION_PROTOCOLS.has(protocol)) {
    throw new ValidationError(
      "line",
      `Link button URL must use http, https, line, or tel, got ${url}`
    );
  }

  if (url.length > MAX_URI_LENGTH) {
    throw new ValidationError(
      "line",
      `Link button URL must be at most ${MAX_URI_LENGTH} characters`
    );
  }

  return url;
};

const toButtonStyle = (
  style: ButtonNode["style"]
): messagingApi.FlexButton.StyleEnum =>
  style === "primary" ? "primary" : "secondary";

const toPostbackButton = (
  button: ButtonNode
): messagingApi.FlexButton | undefined => {
  if (!button.id || button.disabled) {
    return undefined;
  }

  const label = renderSdkEmoji(button.label || button.id);

  return {
    action: {
      data: serializePostbackData(button.id, button.value),
      displayText: truncateGraphemes(label, MAX_ACTION_DISPLAY_TEXT_GRAPHEMES),
      label: truncateGraphemes(label, MAX_BUTTON_LABEL_GRAPHEMES),
      type: "postback",
    },
    style: toButtonStyle(button.style),
    type: "button",
  };
};

const toUriAction = (label: string, url: string): messagingApi.URIAction => ({
  label: truncateGraphemes(
    renderSdkEmoji(label || url),
    MAX_BUTTON_LABEL_GRAPHEMES
  ),
  type: "uri",
  uri: readLinkUrl(url),
});

const toLinkButton = (button: LinkButtonNode): messagingApi.FlexButton => ({
  action: toUriAction(button.label, button.url),
  style: toButtonStyle(button.style),
  type: "button",
});

const toLinkText = (link: LinkNode): messagingApi.FlexText =>
  toFlexText(link.label || link.url, {
    action: toUriAction(link.label, link.url),
    color: LINK_COLOR,
    decoration: "underline",
    margin: "md",
    size: "md",
  });

const toFooterButton = (
  action: ActionChild
): messagingApi.FlexButton | undefined => {
  switch (action.type) {
    case "button": {
      return toPostbackButton(action);
    }
    case "link-button": {
      return toLinkButton(action);
    }
    default: {
      return undefined;
    }
  }
};

const renderNode = (node: CardNode, blocks: BubbleBlocks): void => {
  switch (node.type) {
    case "text": {
      if (!isNonEmptyString(node.content)) {
        return;
      }
      blocks.body.push(
        toFlexText(node.content, {
          margin: "md",
          size: "md",
          ...TEXT_STYLE_OPTIONS[node.style ?? ""],
        })
      );
      return;
    }
    case "link": {
      blocks.body.push(toLinkText(node));
      return;
    }
    case "section": {
      for (const child of node.children) {
        renderNode(child, blocks);
      }
      return;
    }
    case "divider": {
      blocks.body.push({ margin: "md", type: "separator" });
      return;
    }
    case "image": {
      blocks.body.push({
        aspectMode: "fit",
        margin: "md",
        size: "full",
        type: "image",
        url: readContentUrl(node.url, "image.url"),
      });
      return;
    }
    case "fields": {
      for (const field of node.children) {
        blocks.body.push({
          contents: [
            toTextOrFiller(field.label, { ...MUTED_TEXT, flex: 2 }),
            toTextOrFiller(field.value, { flex: 5, size: "sm" }),
          ],
          layout: "baseline",
          margin: "sm",
          spacing: "sm",
          type: "box",
        });
      }
      return;
    }
    case "table": {
      blocks.body.push(
        ...toGridComponents({
          align: node.align,
          headers: node.headers,
          note: readTableCaption(node),
          rows: node.rows,
        })
      );
      return;
    }
    case "chart": {
      if (isNonEmptyString(node.title)) {
        blocks.body.push(
          toFlexText(node.title, { margin: "md", size: "md", weight: "bold" })
        );
      }
      blocks.body.push(...toGridComponents(toChartGrid(node.chart)));
      return;
    }
    case "actions": {
      for (const action of node.children) {
        const button = toFooterButton(action);
        if (button) {
          blocks.footer.push(button);
        }
      }
      return;
    }
    default: {
      const fallback = cardChildToFallbackText(node);
      if (isNonEmptyString(fallback)) {
        blocks.body.push(toFlexText(fallback, { margin: "md", size: "md" }));
      }
    }
  }
};

const buildBlocks = (card: CardElement): BubbleBlocks => {
  const blocks: BubbleBlocks = { body: [], footer: [] };

  if (card.title) {
    blocks.body.push(toFlexText(card.title, { size: "xl", weight: "bold" }));
  }
  if (card.subtitle) {
    blocks.body.push(
      toFlexText(card.subtitle, { ...MUTED_TEXT, margin: "xs" })
    );
  }
  for (const child of card.children) {
    renderNode(child, blocks);
  }

  return blocks;
};

const buildAltText = (card: CardElement): string => {
  const parts = [
    card.title,
    card.subtitle,
    ...card.children.map((child) => cardChildToFallbackText(child)),
  ]
    .map((part) => part?.trim())
    .filter(isNonEmptyString);
  const text = renderSdkEmoji(parts.join("\n"));

  return (
    text.slice(0, lastGraphemeBoundary(text, MAX_ALT_TEXT_LENGTH)) ||
    "Flex Message"
  );
};

/**
 * Converts a Chat SDK CardElement into a LINE Flex Message payload.
 *
 * The card's `imageUrl` becomes the bubble hero. The title, subtitle, and
 * every child, sections included, fill the body: text keeps its bold or
 * muted style, links become tappable text, dividers become separators, images become Flex images,
 * fields become label and value rows, and tables and charts become grids of
 * equal-width columns. Buttons anywhere in the card become the footer, as
 * postback actions or, for link buttons, URI actions; disabled buttons and
 * buttons without an ID are left out. A child this converter has no layout
 * for renders as the Chat SDK's fallback text when it has one. An image or
 * link URL LINE would reject throws `ValidationError`.
 *
 * The notification text is the title, subtitle, and each child's fallback
 * text, cut at LINE's 1500-character limit without splitting a character.
 * A card with no content at all shows "Empty Card" with "Flex Message" as
 * its notification text.
 */
export const buildFlexMessage = (
  card: CardElement
): messagingApi.FlexMessage => {
  const { body, footer } = buildBlocks(card);
  const hero: messagingApi.FlexImage | undefined = card.imageUrl
    ? {
        aspectMode: "cover",
        aspectRatio: "20:13",
        size: "full",
        type: "image",
        url: readContentUrl(card.imageUrl, "card.imageUrl"),
      }
    : undefined;

  if (body.length === 0 && footer.length === 0 && hero === undefined) {
    body.push(toFlexText("Empty Card"));
  }

  const bubble: messagingApi.FlexBubble = { type: "bubble" };

  if (hero) {
    bubble.hero = hero;
  }
  if (body.length > 0) {
    bubble.body = { contents: body, layout: "vertical", type: "box" };
  }
  if (footer.length > 0) {
    bubble.footer = {
      contents: footer,
      layout: "vertical",
      spacing: "sm",
      type: "box",
    };
  }

  return { altText: buildAltText(card), contents: bubble, type: "flex" };
};

/**
 * Wraps a caller-supplied Flex payload in a LINE Flex Message.
 *
 * This checks the envelope only. `contents` passes through untouched, because
 * LINE validates the component tree itself and the payload producer knows
 * which schema level it targets.
 */
export const buildNativeFlexMessage = (
  flex: unknown
): messagingApi.FlexMessage => {
  if (!isRecord(flex)) {
    throw new ValidationError("line", "flex must be an object");
  }

  const { altText, contents } = flex;

  if (typeof altText !== "string" || altText.trim() === "") {
    throw new ValidationError(
      "line",
      "flex.altText must be a non-empty string"
    );
  }

  if (altText.length > MAX_ALT_TEXT_LENGTH) {
    throw new ValidationError(
      "line",
      `flex.altText must be at most ${MAX_ALT_TEXT_LENGTH} characters`
    );
  }

  if (
    !isRecord(contents) ||
    (contents.type !== "bubble" && contents.type !== "carousel")
  ) {
    throw new ValidationError(
      "line",
      'flex.contents must be a Flex container with type "bubble" or "carousel"'
    );
  }

  return {
    altText,
    contents: contents as messagingApi.FlexContainer,
    type: "flex",
  };
};
