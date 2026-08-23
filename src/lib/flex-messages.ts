import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";
import type { ButtonElement, CardElement } from "chat";

/** LINE caps postback `data` at 300 characters. */
const MAX_POSTBACK_DATA_LENGTH = 300;
/** LINE caps button labels at 20 characters. */
const MAX_BUTTON_LABEL_LENGTH = 20;
/** LINE caps display text on postback actions at 300 characters. */
const MAX_ACTION_DISPLAY_TEXT_LENGTH = 300;

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

const toFlexText = (
  text: string,
  options: Partial<
    Pick<messagingApi.FlexText, "size" | "weight" | "color" | "margin">
  > = {}
): messagingApi.FlexText => ({
  text,
  type: "text",
  wrap: true,
  ...options,
});

const buildBodyContents = (card: CardElement): messagingApi.FlexComponent[] => {
  const contents: messagingApi.FlexComponent[] = [];

  if (card.title) {
    contents.push(toFlexText(card.title, { size: "xl", weight: "bold" }));
  }

  for (const child of card.children) {
    if (child.type === "text") {
      contents.push(toFlexText(child.content, { margin: "md", size: "md" }));
    } else if (child.type === "section") {
      for (const sectionChild of child.children) {
        if (sectionChild.type === "text") {
          contents.push(
            toFlexText(sectionChild.content, { margin: "sm", size: "sm" })
          );
        }
      }
    }
  }

  return contents;
};

const buildFooterButton = (
  button: ButtonElement
): messagingApi.FlexButton | null => {
  if (!button.id) {
    return null;
  }

  const label = button.label || button.id;

  return {
    action: {
      data: serializePostbackData(button.id, button.value),
      displayText: label.slice(0, MAX_ACTION_DISPLAY_TEXT_LENGTH),
      label: label.slice(0, MAX_BUTTON_LABEL_LENGTH),
      type: "postback",
    },
    style: button.style === "primary" ? "primary" : "secondary",
    type: "button",
  };
};

const buildFooterContents = (card: CardElement): messagingApi.FlexButton[] => {
  const buttons: messagingApi.FlexButton[] = [];

  for (const child of card.children) {
    if (child.type !== "actions") {
      continue;
    }

    for (const actionChild of child.children) {
      if (actionChild.type !== "button") {
        continue;
      }

      const flexButton = buildFooterButton(actionChild);
      if (flexButton) {
        buttons.push(flexButton);
      }
    }
  }

  return buttons;
};

/**
 * Converts a Chat SDK CardElement into a LINE Flex Message payload.
 *
 * The card title, text, and section children become the bubble body;
 * buttons inside actions become the bubble footer as postback actions.
 */
export const buildFlexMessage = (
  card: CardElement
): messagingApi.FlexMessage => {
  const bodyContents = buildBodyContents(card);
  const footerContents = buildFooterContents(card);

  if (bodyContents.length === 0) {
    bodyContents.push(toFlexText("Empty Card"));
  }

  const bubble: messagingApi.FlexBubble = {
    body: {
      contents: bodyContents,
      layout: "vertical",
      type: "box",
    },
    type: "bubble",
  };

  if (footerContents.length > 0) {
    bubble.footer = {
      contents: footerContents,
      layout: "vertical",
      spacing: "sm",
      type: "box",
    };
  }

  return {
    altText: card.title || "Flex Message",
    contents: bubble,
    type: "flex",
  };
};
