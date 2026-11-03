import { expect } from "vitest";

/** JSON that survives BigInt values (Prisma returns them for money columns). */
function describeValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

/**
 * A soft assertion with a readable name: a failed check is reported with its name and detail,
 * and the rest of the test keeps running so one run shows every broken expectation.
 */
export function check(name: string, condition: boolean, detail?: unknown): void {
  expect.soft(condition, condition || detail === undefined ? name : `${name} -> ${describeValue(detail)}`).toBe(true);
}
