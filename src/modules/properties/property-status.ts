import type { RentalMode, UsageType } from "../../generated/prisma/enums.js";

/** Derived, never stored: it follows the property's usage and its rental data. */
export type PropertyStatus = "own_use" | "loan_for_use" | "rented" | "vacant";

export interface PropertyStatusInput {
  usageType: UsageType;
  rentalMode: RentalMode;
  manualRental: { tenantName: string | null; monthlyRentCents: bigint } | null;
  hasActiveContract: boolean;
}

/**
 * Own use and loan for use are kept as declared. Otherwise the property is rented when it has
 * a tenant or rent (manual mode) or an active contract (contract mode), and vacant when not.
 */
export function derivePropertyStatus(input: PropertyStatusInput): PropertyStatus {
  if (input.usageType === "own_use") return "own_use";
  if (input.usageType === "loan_for_use") return "loan_for_use";

  if (input.rentalMode === "contract") return input.hasActiveContract ? "rented" : "vacant";

  const rental = input.manualRental;
  const rented = rental !== null && (Boolean(rental.tenantName) || rental.monthlyRentCents > 0n);
  return rented ? "rented" : "vacant";
}
