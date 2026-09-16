import { ValidationError } from "@chat-adapter/shared";
import type { messagingApi } from "@line/bot-sdk";

import type { LineLocation, LineMessageEvent } from "../types.js";
import { isRecord } from "./is-record.js";

/** LINE caps a location title and address at 100 characters each. */
const MAX_LOCATION_TEXT_LENGTH = 100;

/** Latitude runs from the south pole to the north pole. */
const MAX_LATITUDE = 90;

/** Longitude runs from the antimeridian west to the antimeridian east. */
const MAX_LONGITUDE = 180;

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= limit;

/**
 * Reads the place off an inbound location message event.
 *
 * Returns undefined for any other message type, and for coordinates that
 * are missing or outside the geographic ranges, so a malformed event never
 * arrives as a plausible-looking place. LINE leaves the title and address
 * optional, because a sender can drop a pin without naming it.
 */
export const parseInboundLocation = (
  message: LineMessageEvent["message"]
): LineLocation | undefined => {
  if (message.type !== "location") {
    return undefined;
  }

  const { latitude, longitude } = message;

  if (
    !isCoordinate(latitude, MAX_LATITUDE) ||
    !isCoordinate(longitude, MAX_LONGITUDE)
  ) {
    return undefined;
  }

  const location: LineLocation = { latitude, longitude };

  if (typeof message.title === "string" && message.title !== "") {
    location.title = message.title;
  }

  if (typeof message.address === "string" && message.address !== "") {
    location.address = message.address;
  }

  return location;
};

const readLocationText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(
      "line",
      `location.${field} must be a non-empty string`
    );
  }

  if (value.length > MAX_LOCATION_TEXT_LENGTH) {
    throw new ValidationError(
      "line",
      `location.${field} must be at most ${MAX_LOCATION_TEXT_LENGTH} characters`
    );
  }

  return value;
};

const readCoordinate = (
  value: unknown,
  field: string,
  limit: number
): number => {
  if (!isCoordinate(value, limit)) {
    throw new ValidationError(
      "line",
      `location.${field} must be a number between -${limit} and ${limit}, got ${String(value)}`
    );
  }

  return value;
};

/**
 * Builds the outbound LINE location message for a `location` postable.
 *
 * LINE drops the pin at the coordinates and shows the title and address
 * beside it, and requires all four. An inbound `LineMessage.location` from
 * an unnamed pin therefore needs a title and address filled in before it
 * can be sent back.
 */
export const buildLocationMessage = (
  location: unknown
): messagingApi.LocationMessage => {
  if (!isRecord(location)) {
    throw new ValidationError("line", "location must be an object");
  }

  const title = readLocationText(location.title, "title");
  const address = readLocationText(location.address, "address");
  const latitude = readCoordinate(location.latitude, "latitude", MAX_LATITUDE);
  const longitude = readCoordinate(
    location.longitude,
    "longitude",
    MAX_LONGITUDE
  );

  return { address, latitude, longitude, title, type: "location" };
};
