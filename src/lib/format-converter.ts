/* eslint-disable class-methods-use-this */
import type { Content, Root } from "chat";
import {
  BaseFormatConverter,
  getNodeChildren,
  isBlockquoteNode,
  isCodeNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isTableNode,
  paragraph,
  root,
  tableElementToAscii,
  text,
} from "chat";

import { renderSdkEmoji } from "./emojis.js";

type ListNode = Extract<Content, { type: "list" }>;

const AUTOLINK_SCHEMES = ["mailto:", "http://", "https://"] as const;

const isBareUrl = (label: string, url: string): boolean =>
  label === url ||
  AUTOLINK_SCHEMES.some((scheme) => url === `${scheme}${label}`);

/**
 * Converts between LINE text and the Chat SDK's Markdown AST.
 *
 * LINE renders no Markdown in either direction. Inbound text is taken
 * literally, and outbound Markdown is flattened to plain text straight from
 * its AST: formatting markers are dropped, while code, link targets, list
 * markers, and task-list checkboxes are kept.
 */
export class LineFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return root([paragraph([text(platformText)])]);
  }

  fromAst(ast: Root): string {
    return renderSdkEmoji(this.renderBlocks(ast.children));
  }

  private renderBlocks(nodes: Content[]): string {
    return nodes
      .map((node) => this.nodeToText(node))
      .filter((block) => block.trim() !== "")
      .join("\n\n");
  }

  private nodeToText(node: Content): string {
    const convert = (child: Content): string => this.nodeToText(child);

    if (isCodeNode(node) || isInlineCodeNode(node) || node.type === "html") {
      return node.value;
    }
    if (node.type === "break") {
      return "\n";
    }
    if (node.type === "thematicBreak") {
      return "";
    }
    if (isListNode(node)) {
      return this.renderList(this.withTaskMarkers(node), 0, convert);
    }
    if (isTableNode(node)) {
      return this.renderTable(node, convert);
    }
    if (isBlockquoteNode(node)) {
      return this.renderBlocks(getNodeChildren(node));
    }
    if (isLinkNode(node)) {
      return this.renderLink(node, convert);
    }
    if (node.type === "image") {
      return node.alt ? `${node.alt} (${node.url})` : node.url;
    }
    if (node.type === "definition") {
      return `[${node.label ?? node.identifier}]: ${node.url}`;
    }
    if (node.type === "imageReference") {
      return node.alt ?? "";
    }
    if (node.type === "footnoteReference") {
      return `[${node.label ?? node.identifier}]`;
    }
    if (node.type === "footnoteDefinition") {
      return `[${node.label ?? node.identifier}]: ${this.renderBlocks(getNodeChildren(node))}`;
    }
    return this.defaultNodeToText(node, convert);
  }

  private renderLink(
    node: Extract<Content, { type: "link" }>,
    convert: (child: Content) => string
  ): string {
    const label = getNodeChildren(node).map(convert).join("");
    if (label === "") {
      return node.url;
    }
    return isBareUrl(label, node.url) ? label : `${label} (${node.url})`;
  }

  private renderTable(
    node: Content,
    convert: (child: Content) => string
  ): string {
    const [headers = [], ...rows] = getNodeChildren(node).map((row) =>
      getNodeChildren(row).map((cell) =>
        getNodeChildren(cell).map(convert).join("")
      )
    );
    return tableElementToAscii(headers, rows);
  }

  private withTaskMarkers(list: ListNode): ListNode {
    return {
      ...list,
      children: list.children.map((item) => this.markTaskItem(item)),
    };
  }

  private markTaskItem(
    item: ListNode["children"][number]
  ): ListNode["children"][number] {
    const children = item.children.map((child) =>
      child.type === "list" ? this.withTaskMarkers(child) : child
    );
    const [first, ...rest] = children;
    if (typeof item.checked !== "boolean" || first?.type !== "paragraph") {
      return { ...item, children };
    }

    const marker = text(item.checked ? "[x] " : "[ ] ");
    return {
      ...item,
      children: [{ ...first, children: [marker, ...first.children] }, ...rest],
    };
  }
}
