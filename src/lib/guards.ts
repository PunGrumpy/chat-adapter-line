/** Narrows a value LINE may have sent in any shape to a usable string. */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** Narrows a count, index, or size, all of which LINE reports from zero up. */
export const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
