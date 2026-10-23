export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

export const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
