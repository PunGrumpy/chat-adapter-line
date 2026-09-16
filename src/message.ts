import { Message } from "chat";
import type { MessageData } from "chat";

import type { LineEvent, LineMention, LineSticker } from "./types.js";

export interface LineMessageData extends MessageData<LineEvent> {
  mentions: LineMention[];
  quoteToken?: string;
  sticker?: LineSticker;
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

  /**
   * The sticker this message carries, on a sticker message. Pass it back on
   * a `sticker` postable to send the same sticker.
   */
  readonly sticker?: LineSticker;

  constructor(data: LineMessageData) {
    super(data);
    this.mentions = data.mentions;
    this.quoteToken = data.quoteToken;
    this.sticker = data.sticker;
  }
}
