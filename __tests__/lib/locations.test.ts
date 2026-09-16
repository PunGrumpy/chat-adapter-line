import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLocationMessage,
  parseInboundLocation,
} from "../../src/lib/locations.js";
import type { LineMessageEvent } from "../../src/types.js";

type RawMessage = LineMessageEvent["message"];

const TOKYO = { latitude: 35.679_66, longitude: 139.736_69 };

const locationMessage = (overrides: Partial<RawMessage> = {}): RawMessage =>
  ({
    address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
    id: "msg-1",
    title: "my location",
    type: "location",
    ...TOKYO,
    ...overrides,
  }) as RawMessage;

describe("parseInboundLocation", () => {
  it("reads the coordinates, title, and address", () => {
    expect(parseInboundLocation(locationMessage())).toEqual({
      address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
      title: "my location",
      ...TOKYO,
    });
  });

  it("returns undefined for a non-location message", () => {
    expect(
      parseInboundLocation({ id: "msg-1", text: "hi", type: "text" })
    ).toBeUndefined();
  });

  it("keeps a pin the sender did not name", () => {
    expect(
      parseInboundLocation(
        locationMessage({ address: undefined, title: undefined })
      )
    ).toEqual(TOKYO);
  });

  it("omits an empty title and address", () => {
    expect(
      parseInboundLocation(locationMessage({ address: "", title: "" }))
    ).toEqual(TOKYO);
  });

  it.each([
    ["missing latitude", { latitude: undefined }],
    ["missing longitude", { longitude: undefined }],
    ["a latitude past the pole", { latitude: 90.1 }],
    ["a longitude past the antimeridian", { longitude: -180.1 }],
    ["a string latitude", { latitude: "35.67966" as never }],
    ["an infinite longitude", { longitude: Number.POSITIVE_INFINITY }],
    ["a NaN latitude", { latitude: Number.NaN }],
  ])("returns undefined rather than invent a place for %s", (_l, overrides) => {
    expect(parseInboundLocation(locationMessage(overrides))).toBeUndefined();
  });

  it.each([
    ["the equator and prime meridian", { latitude: 0, longitude: 0 }],
    ["the poles", { latitude: -90, longitude: 180 }],
  ])("accepts %s", (_label, coordinates) => {
    expect(parseInboundLocation(locationMessage(coordinates))).toMatchObject(
      coordinates
    );
  });
});

describe("buildLocationMessage", () => {
  const location = {
    address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
    title: "my location",
    ...TOKYO,
  };

  it("builds a native location message", () => {
    expect(buildLocationMessage(location)).toEqual({
      ...location,
      type: "location",
    });
  });

  it.each([
    ["a non-object", "Tokyo"],
    ["a missing title", { ...location, title: undefined }],
    ["an empty address", { ...location, address: "" }],
    ["a whitespace-only title", { ...location, title: "   " }],
    ["a non-string title", { ...location, title: 42 }],
    ["a title over 100 characters", { ...location, title: "t".repeat(101) }],
    [
      "an address over 100 characters",
      { ...location, address: "a".repeat(101) },
    ],
    ["a latitude past the pole", { ...location, latitude: 91 }],
    ["a longitude past the antimeridian", { ...location, longitude: 181 }],
    ["a string latitude", { ...location, latitude: "35.67966" }],
    ["a NaN longitude", { ...location, longitude: Number.NaN }],
  ])("rejects %s", (_label, bad) => {
    expect(() => buildLocationMessage(bad)).toThrow(ValidationError);
  });

  it("accepts a title and address at exactly 100 characters", () => {
    expect(
      buildLocationMessage({
        ...location,
        address: "a".repeat(100),
        title: "t".repeat(100),
      })
    ).toMatchObject({ type: "location" });
  });

  it("needs a title and address on a pin the sender did not name", () => {
    const inbound = parseInboundLocation(
      locationMessage({ address: undefined, title: undefined })
    );

    expect(() => buildLocationMessage(inbound)).toThrow(ValidationError);
    expect(
      buildLocationMessage({ ...inbound, address: "Kioicho", title: "Office" })
    ).toEqual({
      address: "Kioicho",
      title: "Office",
      type: "location",
      ...TOKYO,
    });
  });
});
