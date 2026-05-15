import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

const MAX_POSTBACK_DATA_LENGTH = 300;

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
 */
export const deserializePostbackData = (
  data: string
): { id: string; value?: string } | null => {
  try {
    const params = new URLSearchParams(data);
    const id = params.get("id");
    const value = params.get("v") || undefined;

    if (!id) {
      return null;
    }

    return { id, value };
  } catch {
    return null;
  }
};

/**
 * Converts Chat SDK Card JSX into a LINE Flex Message payload.
 */
// eslint-disable-next-line complexity
export const buildFlexMessage = (card: unknown): messagingApi.FlexMessage => {
  const bodyContents: messagingApi.FlexComponent[] = [];
  const footerContents: messagingApi.FlexButton[] = [];

  const typedCard = card as Record<string, unknown>;
  const props = (typedCard?.props as Record<string, unknown>) || {};

  if (props.title) {
    bodyContents.push({
      size: "xl",
      text: props.title as string,
      type: "text",
      weight: "bold",
      wrap: true,
    });
  }

  let children: unknown[];
  if (Array.isArray(props.children)) {
    ({ children } = props);
  } else if (props.children) {
    children = [props.children];
  } else {
    children = [];
  }

  for (const child of children) {
    if (!child || typeof child !== "object") {
      continue;
    }

    const typedChild = child as Record<string, unknown>;
    const { type } = typedChild;
    const childProps = (typedChild.props as Record<string, unknown>) || {};

    if (type === "CardText") {
      bodyContents.push({
        margin: "md",
        size: "md",
        text: (childProps.children as string) || "",
        type: "text",
        wrap: true,
      });
    } else if (type === "Section") {
      if (childProps.title) {
        bodyContents.push({
          color: "#aaaaaa",
          margin: "md",
          size: "sm",
          text: childProps.title as string,
          type: "text",
          weight: "bold",
        });
      }

      let sectionChildren: unknown[];
      if (Array.isArray(childProps.children)) {
        sectionChildren = childProps.children;
      } else if (childProps.children) {
        sectionChildren = [childProps.children];
      } else {
        sectionChildren = [];
      }

      for (const sectionChild of sectionChildren) {
        if (!sectionChild || typeof sectionChild !== "object") {
          continue;
        }

        const typedSectionChild = sectionChild as Record<string, unknown>;
        const sectionChildType = typedSectionChild.type;
        const sectionChildProps =
          (typedSectionChild.props as Record<string, unknown>) || {};

        if (sectionChildType === "CardText") {
          bodyContents.push({
            margin: "sm",
            size: "sm",
            text: (sectionChildProps.children as string) || "",
            type: "text",
            wrap: true,
          });
        }
      }
    } else if (type === "Actions") {
      let actionChildren: unknown[];
      if (Array.isArray(childProps.children)) {
        actionChildren = childProps.children;
      } else if (childProps.children) {
        actionChildren = [childProps.children];
      } else {
        actionChildren = [];
      }

      for (const actionChild of actionChildren) {
        if (!actionChild || typeof actionChild !== "object") {
          continue;
        }

        const typedActionChild = actionChild as Record<string, unknown>;
        const actionChildType = typedActionChild.type;
        const actionChildProps =
          (typedActionChild.props as Record<string, unknown>) || {};

        if (actionChildType === "Button") {
          const actionId =
            (actionChildProps.id as string) ||
            (actionChildProps.actionId as string);
          const actionValue = actionChildProps.value as string;

          if (!actionId) {
            continue;
          }

          const label = (actionChildProps.children as string) || actionId;

          footerContents.push({
            action: {
              data: serializePostbackData(actionId, actionValue),
              displayText: String(label).slice(0, 300),
              label: String(label).slice(0, 20),
              type: "postback",
            },
            style:
              actionChildProps.style === "primary" ? "primary" : "secondary",
            type: "button",
          });
        }
      }
    }
  }

  if (bodyContents.length === 0) {
    bodyContents.push({
      text: "Empty Card",
      type: "text",
      wrap: true,
    });
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
    altText: (props.title as string) || "Flex Message",
    contents: bubble,
    type: "flex",
  };
};
