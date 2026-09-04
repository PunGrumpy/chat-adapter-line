/* eslint-disable class-methods-use-this */
import type { AdapterPostableMessage, Root } from "chat";
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from "chat";

import { toPlainText } from "./to-plain-text.js";

export class LineFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    const rendered = super.renderPostable(message);
    return toPlainText(rendered);
  }
}
