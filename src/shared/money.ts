/**
 * Money is stored as integer cents (BigInt) and exposed in the API as a plain integer number of cents.
 * `JSON.stringify` cannot serialize BigInt, so the DTO layer converts at the boundary.
 */
export function centsToNumber(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Amount in cents does not fit a safe integer");
  }
  return Number(cents);
}

export function numberToCents(value: number): bigint {
  return BigInt(value);
}
