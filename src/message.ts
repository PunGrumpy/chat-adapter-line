import { Message } from "chat";
import type { MessageData } from "chat";

import type {
  LineEmoji,
  LineEvent,
  LineLocation,
  LineMention,
  LineSticker,
} from "./types.js";

export interface LineMessageData extends MessageData<LineEvent> {
  emojis: LineEmoji[];
  location?: LineLocation;
  mentions: LineMention[];
  quoteToken?: string;
  quotedMessageId?: string;
  sticker?: LineSticker;
}

/**
 * An inbound LINE message with the LINE-native fields the Chat SDK's
 * `Message` has no slot for.
 */
export class LineMessage extends Message<LineEvent> {
  /**
   * Native LINE emoji on this message, in the order LINE reported them. The
   * text keeps the emoji sequences these entries point at.
   */
  readonly emojis: LineEmoji[];

  /**
   * The place this message points at, on a location message. Fill in a title
   * and address to send it back on a `location` postable.
   */
  readonly location?: LineLocation;

  /** Native mentions on this message, in the order LINE reported them. */
  readonly mentions: LineMention[];

  /**
   * Token for quoting this message in a reply. LINE issues one for text,
   * image, video, and sticker messages. Pass it as `quoteToken` on an
   * outbound text postable.
   */
  readonly quoteToken?: string;

  /**
   * LINE's ID for the message this one quotes, on a message that quotes an
   * earlier one. It identifies the quoted message without resolving it: the
   * adapter never fetches the message behind the ID.
   */
  readonly quotedMessageId?: string;

  /**
   * The sticker this message carries, on a sticker message. Pass it back on
   * a `sticker` postable to send the same sticker.
   */
  readonly sticker?: LineSticker;

  constructor(data: LineMessageData) {
    super(data);
    this.emojis = data.emojis;
    this.location = data.location;
    this.mentions = data.mentions;
    this.quoteToken = data.quoteToken;
    this.quotedMessageId = data.quotedMessageId;
    this.sticker = data.sticker;
  }
}
