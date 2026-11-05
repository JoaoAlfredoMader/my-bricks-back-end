import type { UsageType } from "../../generated/prisma/enums.js";
import type { CashFlow, IrrUnavailableReason, PortfolioKpis } from "./kpi-calculations.js";
import type { PropertyStatus } from "../properties/property-status.js";

/** Where the revenue of a property comes from. */
export type RevenueSource = "manual" | "contract" | "reservations" | "none";

/** Money is integer cents; yields, cap rate and IRR are fractions (0.07 = 7%). */
export interface PropertyKpisDto {
  propertyId: string;
  name: string;
  clientId: string | null;
  usageType: UsageType;
  status: PropertyStatus;
  ownershipPercentage: number;
  estimatedValueCents: number | null;
  revenueSource: RevenueSource;
  /** Monthly rent, or the monthly average of the last 12 months of bookings. */
  monthlyRentCents: number;
  /** Own use and loan for use are left out of yields and portfolio income. */
  includedInPortfolio: boolean;
  annualRevenueCents: number;
  annualExpensesCents: number;
  noiCents: number;
  grossYield: number | null;
  capRate: number | null;
  irr: { annualRate: number | null; unavailableReason: IrrUnavailableReason | null; months: number | null };
}

export interface PortfolioKpisDto {
  asOf: string;
  totals: PortfolioKpis;
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatus, number>;
  properties: PropertyKpisDto[];
}

/** Money is integer cents; months are `YYYY-MM`. */
export type CashFlowDto = CashFlow;
