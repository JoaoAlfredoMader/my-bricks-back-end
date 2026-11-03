/** Floating-point comparison for rates and yields. */
export const near = (a: number | null | undefined, b: number, eps = 1e-6): boolean =>
  typeof a === "number" && Math.abs(a - b) <= eps;
