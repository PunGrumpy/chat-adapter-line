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
  tableToAscii,
  text,
} from "chat";

/** URL schemes an autolink adds in front of the text it was written as. */
const AUTOLINK_SCHEMES = ["mailto:", "http://", "https://"] as const;

/** True when a link's text is only its URL, as written or as autolinked. */
const isBareUrl = (label: string, url: string): boolean =>
  label === url ||
  AUTOLINK_SCHEMES.some((scheme) => url === `${scheme}${label}`);

/**
 * Converts between LINE text and the Chat SDK's Markdown AST.
 *
 * LINE renders no Markdown in either direction. Inbound text is taken
 * literally, and outbound Markdown is flattened to plain text straight from
 * its AST: formatting markers are dropped, while code, link targets, and list
 * markers are kept. Serializing to Markdown and stripping it with patterns,
 * as this class once did, added escapes and rewrote ordinary text.
 */
export class LineFormatConverter extends BaseFormatConverter {
  /** LINE text is plain text, so it becomes one literal paragraph. */
  toAst(platformText: string): Root {
    return root([paragraph([text(platformText)])]);
  }

  /** Renders an AST as the plain text LINE displays. */
  fromAst(ast: Root): string {
    return this.renderBlocks(ast.children);
  }

  /** Renders block nodes a blank line apart, skipping ones that render empty. */
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
      return this.renderList(node, 0, convert);
    }
    if (isTableNode(node)) {
      return tableToAscii(node);
    }
    if (isBlockquoteNode(node)) {
      return this.renderBlocks(getNodeChildren(node));
    }
    if (isLinkNode(node)) {
      const label = getNodeChildren(node).map(convert).join("");
      if (label === "") {
        return node.url;
      }
      return isBareUrl(label, node.url) ? label : `${label} (${node.url})`;
    }
    if (node.type === "image") {
      return node.alt ? `${node.alt} (${node.url})` : node.url;
    }
    if (node.type === "definition") {
      return `[${node.label ?? node.identifier}]: ${node.url}`;
    }
    return this.defaultNodeToText(node, convert);
  }
}
