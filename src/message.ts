import { Message } from "chat";
import type { MessageData } from "chat";

import type { LineEvent } from "./types.js";

export interface LineMessageData extends MessageData<LineEvent> {
  quoteToken?: string;
}

/**
 * An inbound LINE message with the LINE-native fields the Chat SDK's
 * `Message` has no slot for.
 */
export class LineMessage extends Message<LineEvent> {
  /**
   * Token for quoting this message in a reply. LINE issues one for text,
   * image, video, and sticker messages. Pass it as `quoteToken` on an
   * outbound text postable.
   */
  readonly quoteToken?: string;

  constructor(data: LineMessageData) {
    super(data);
    this.quoteToken = data.quoteToken;
  }
}
