import type { UsageType } from "../../generated/prisma/enums.js";

/**
 * Pure portfolio maths: no database, no HTTP. Amounts are integer cents (as numbers),
 * rates and yields are fractions (0.07 = 7%).
 */

/** Where a property's revenue comes from. */
export type RentBasis =
  /** A monthly rent that is expected to be received (manual rent, conventional contract): occupancy applies. */
  | { kind: "nominal"; monthlyCents: number }
  /** Average of what was actually booked in the last 12 months (short stay): occupancy is already in it. */
  | { kind: "realized"; monthlyCents: number }
  | { kind: "none" };

export interface PropertyKpiInput {
  usageType: UsageType;
  /** Ownership share, 0-100. */
  ownershipPercentage: number;
  estimatedValueCents: number | null;
  annualExpensesCents: number;
  /** Expected occupancy, 0-100. */
  occupancyRate: number;
  rent: RentBasis;
}

export interface PropertyKpis {
  /** Own use and loan for use produce no income, so they are left out of yields and portfolio income. */
  includedInPortfolio: boolean;
  annualRevenueCents: number;
  annualExpensesCents: number;
  /** Net operating income per year: revenue minus expenses. */
  noiCents: number;
  /** Annual revenue / estimated value. `null` without a value or for properties without income. */
  grossYield: number | null;
  /** NOI / estimated value. `null` without a value or for properties without income. */
  capRate: number | null;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export function isIncomeProducing(usageType: UsageType): boolean {
  return usageType !== "own_use" && usageType !== "loan_for_use";
}

export function annualRevenueCents(rent: RentBasis, occupancyRate: number): number {
  switch (rent.kind) {
    case "nominal":
      return Math.round((rent.monthlyCents * 12 * occupancyRate) / 100);
    case "realized":
      return Math.round(rent.monthlyCents * 12);
    case "none":
      return 0;
  }
}

export function computePropertyKpis(input: PropertyKpiInput): PropertyKpis {
  const includedInPortfolio = isIncomeProducing(input.usageType);
  const revenue = includedInPortfolio ? annualRevenueCents(input.rent, input.occupancyRate) : 0;
  const noi = revenue - input.annualExpensesCents;
  const value = input.estimatedValueCents;
  const hasValue = includedInPortfolio && value !== null && value > 0;

  return {
    includedInPortfolio,
    annualRevenueCents: revenue,
    annualExpensesCents: input.annualExpensesCents,
    noiCents: noi,
    grossYield: hasValue ? round6(revenue / value) : null,
    capRate: hasValue ? round6(noi / value) : null,
  };
}

export interface PortfolioRow {
  ownershipPercentage: number;
  estimatedValueCents: number | null;
  kpis: PropertyKpis;
}

export interface PortfolioKpis {
  /** Estimated value of every property with a value, weighted by ownership share. */
  totalValueCents: number;
  /** The part of it that produces income: the base of the portfolio yield and cap rate. */
  incomeProducingValueCents: number;
  /** Income-producing properties, weighted by ownership share. */
  annualRevenueCents: number;
  annualExpensesCents: number;
  noiCents: number;
  /** Revenue / value over the income-producing properties that have a value. */
  grossYield: number | null;
  /** NOI / value over the income-producing properties that have a value. */
  capRate: number | null;
}

/**
 * Portfolio totals are weighted by ownership share. Yield and cap rate only use properties that
 * have a value, on both sides of the division, so a property without a value cannot skew them.
 */
export function aggregatePortfolio(rows: readonly PortfolioRow[]): PortfolioKpis {
  let totalValue = 0;
  let incomeValue = 0;
  let revenue = 0;
  let expenses = 0;
  let noi = 0;
  let valuedRevenue = 0;
  let valuedNoi = 0;

  for (const row of rows) {
    const share = row.ownershipPercentage / 100;
    const value = row.estimatedValueCents ?? 0;
    totalValue += value * share;
    if (!row.kpis.includedInPortfolio) continue;

    revenue += row.kpis.annualRevenueCents * share;
    expenses += row.kpis.annualExpensesCents * share;
    noi += row.kpis.noiCents * share;
    if (value > 0) {
      incomeValue += value * share;
      valuedRevenue += row.kpis.annualRevenueCents * share;
      valuedNoi += row.kpis.noiCents * share;
    }
  }

  return {
    totalValueCents: Math.round(totalValue),
    incomeProducingValueCents: Math.round(incomeValue),
    annualRevenueCents: Math.round(revenue),
    annualExpensesCents: Math.round(expenses),
    noiCents: Math.round(noi),
    grossYield: incomeValue > 0 ? round6(valuedRevenue / incomeValue) : null,
    capRate: incomeValue > 0 ? round6(valuedNoi / incomeValue) : null,
  };
}

// ── IRR ─────────────────────────────────────────────────────────────────────

export interface IrrTransaction {
  occurredOn: string;
  /** Positive for revenue, negative for expense. */
  signedAmountCents: number;
  isRecurring: boolean;
  recurrenceEndsOn: string | null;
}

export interface IrrInput {
  /** Purchase date, or base date of an inheritance: month 0 of the cash flow. */
  acquiredOn: string | null;
  /** Purchase price or base cost: the initial outflow. */
  costCents: number | null;
  estimatedValueCents: number | null;
  /** Revenue minus expenses of one month, held constant over the period. */
  operatingMonthlyCents: number;
  transactions: readonly IrrTransaction[];
  asOf: string;
}

export type IrrUnavailableReason = "no_acquisition_date" | "no_acquisition_cost" | "no_estimated_value" | "period_too_short" | "no_solution";

export interface IrrResult {
  /** Annualized: `(1 + monthly rate)^12 - 1`. */
  annualRate: number | null;
  unavailableReason: IrrUnavailableReason | null;
  /** Months between the acquisition and `asOf`. */
  months: number | null;
}

/** `YYYY-MM-DD` -> months since year 0. */
const monthIndex = (isoDate: string) => Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1;

/**
 * Builds the monthly cash flow from the acquisition month (index 0) to the `asOf` month (index N):
 * the cost goes out at 0, every month after it brings the operating result, transactions land in
 * the month they occur (recurring ones in every month until they end) and the estimated value
 * comes back at N as the terminal value.
 */
export function buildCashFlows(input: IrrInput & { acquiredOn: string; costCents: number; estimatedValueCents: number }): number[] {
  const start = monthIndex(input.acquiredOn);
  const months = monthIndex(input.asOf) - start;
  const flows = new Array<number>(months + 1).fill(0);

  flows[0] = -input.costCents;
  for (let t = 1; t <= months; t++) flows[t]! += input.operatingMonthlyCents;

  for (const transaction of input.transactions) {
    const first = monthIndex(transaction.occurredOn) - start;
    const last = transaction.isRecurring
      ? Math.min(transaction.recurrenceEndsOn ? monthIndex(transaction.recurrenceEndsOn) - start : months, months)
      : first;
    for (let t = Math.max(first, 0); t <= last && t <= months; t++) flows[t]! += transaction.signedAmountCents;
  }

  flows[months]! += input.estimatedValueCents;
  return flows;
}

const npv = (flows: readonly number[], rate: number) =>
  flows.reduce((sum, flow, month) => sum + flow / Math.pow(1 + rate, month), 0);

/** Monthly rate where the NPV is zero, by bisection. `null` when the flows never change sign. */
export function solveMonthlyRate(flows: readonly number[]): number | null {
  if (!flows.some((flow) => flow > 0) || !flows.some((flow) => flow < 0)) return null;

  let low = -0.99;
  let high = 1;
  while (Math.sign(npv(flows, low)) === Math.sign(npv(flows, high))) {
    high *= 2;
    if (high > 1e6) return null;
  }

  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2;
    if (Math.sign(npv(flows, mid)) === Math.sign(npv(flows, low))) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function computeIrr(input: IrrInput): IrrResult {
  const unavailable = (reason: IrrUnavailableReason, months: number | null = null): IrrResult => ({
    annualRate: null,
    unavailableReason: reason,
    months,
  });

  if (!input.acquiredOn) return unavailable("no_acquisition_date");
  if (input.costCents === null || input.costCents <= 0) return unavailable("no_acquisition_cost");
  if (input.estimatedValueCents === null || input.estimatedValueCents <= 0) return unavailable("no_estimated_value");

  const months = monthIndex(input.asOf) - monthIndex(input.acquiredOn);
  if (months < 1) return unavailable("period_too_short", months);

  const flows = buildCashFlows({
    ...input,
    acquiredOn: input.acquiredOn,
    costCents: input.costCents,
    estimatedValueCents: input.estimatedValueCents,
  });
  const monthly = solveMonthlyRate(flows);
  if (monthly === null) return unavailable("no_solution", months);

  return { annualRate: round6(Math.pow(1 + monthly, 12) - 1), unavailableReason: null, months };
}
