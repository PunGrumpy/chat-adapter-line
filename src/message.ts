import { Message } from "chat";
import type { MessageData } from "chat";

import type { LineEvent, LineMention } from "./types.js";

export interface LineMessageData extends MessageData<LineEvent> {
  mentions: LineMention[];
  quoteToken?: string;
}

/**
 * An inbound LINE message with the LINE-native fields the Chat SDK's
 * `Message` has no slot for.
 */
export class LineMessage extends Message<LineEvent> {
  /** Native mentions on this message, in the order LINE reported them. */
  readonly mentions: LineMention[];

  /**
   * Token for quoting this message in a reply. LINE issues one for text,
   * image, video, and sticker messages. Pass it as `quoteToken` on an
   * outbound text postable.
   */
  readonly quoteToken?: string;

  constructor(data: LineMessageData) {
    super(data);
    this.mentions = data.mentions;
    this.quoteToken = data.quoteToken;
  }
}
