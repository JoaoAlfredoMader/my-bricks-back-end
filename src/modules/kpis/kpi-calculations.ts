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

// ── Monthly cash flow ───────────────────────────────────────────────────────

/** A calendar month as `YYYY-MM`. */
export type MonthKey = string;

/** Longest window the monthly cash flow answers for. */
export const MAX_CASH_FLOW_MONTHS = 36;

const monthKeyToIndex = (month: MonthKey) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const indexToMonthKey = (index: number): MonthKey =>
  `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;

/** Number of months from `from` to `to`, both included. Zero or negative when `to` is before `from`. */
export function countMonths(from: MonthKey, to: MonthKey): number {
  return monthKeyToIndex(to) - monthKeyToIndex(from) + 1;
}

/** Every month from `from` to `to`, both included, in order. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const start = monthKeyToIndex(from);
  return Array.from({ length: Math.max(countMonths(from, to), 0) }, (_, offset) => indexToMonthKey(start + offset));
}

/**
 * Whether a transaction lands in the month. A one-off one lands in the month of `occurredOn`; a
 * recurring one in every month from the month of `occurredOn` until the month of `recurrenceEndsOn`
 * (inclusive), or without end when it has none. This is the same reading the IRR cash flow uses.
 */
export function transactionOccursIn(transaction: IrrTransaction, month: MonthKey): boolean {
  const target = monthKeyToIndex(month);
  const first = monthIndex(transaction.occurredOn);
  if (!transaction.isRecurring) return first === target;
  if (target < first) return false;
  return transaction.recurrenceEndsOn === null || target <= monthIndex(transaction.recurrenceEndsOn);
}

/** A stretch of a conventional contract's rent. Dates are `YYYY-MM-DD`; the end is `null` while it runs. */
export interface CashFlowRentPeriod {
  monthlyCents: number;
  startsOn: string;
  endsOn: string | null;
}

/** Where a property's income comes from, month by month. Mirrors how the KPIs choose the rent. */
export type CashFlowRevenue =
  | { kind: "none" }
  /** The rent typed on the property: expected income, so the occupancy rate applies. */
  | { kind: "manual"; monthlyCents: number }
  /** Conventional contracts: expected income, so the occupancy rate applies. */
  | { kind: "contracts"; periods: readonly CashFlowRentPeriod[] }
  /** Confirmed bookings: income already realized, so the occupancy rate does not apply. */
  | { kind: "reservations"; reservations: ReadonlyArray<{ checkIn: string; totalCents: number }> };

export interface PropertyCashFlowInput {
  usageType: UsageType;
  /** Expected occupancy, 0-100. */
  occupancyRate: number;
  annualExpensesCents: number;
  revenue: CashFlowRevenue;
  transactions: readonly IrrTransaction[];
}

export interface CashFlowMonth {
  month: MonthKey;
  revenue: { rentCents: number; reservationsCents: number; transactionsCents: number; totalCents: number };
  expenses: { fixedCents: number; transactionsCents: number; totalCents: number };
  netCents: number;
}

export interface CashFlow {
  from: MonthKey;
  to: MonthKey;
  months: CashFlowMonth[];
  totals: { revenueCents: number; expensesCents: number; netCents: number };
}

/** Unrounded amounts of one property in one month. */
interface PropertyMonth {
  rent: number;
  reservations: number;
  revenueTransactions: number;
  fixed: number;
  expenseTransactions: number;
}

/**
 * The rent a contract-mode property earns in a month: the contract in force that month, where a
 * month belongs to a contract from the month it starts to the month it ends, both included (the
 * same by-month reading as the end of a recurring transaction). When a replacement starts in the
 * month the previous contract ended, the one that started last wins, so the month is never counted twice.
 */
function contractRentIn(periods: readonly CashFlowRentPeriod[], month: MonthKey): number {
  const target = monthKeyToIndex(month);
  let winner: CashFlowRentPeriod | null = null;
  for (const period of periods) {
    const covers = monthIndex(period.startsOn) <= target && (period.endsOn === null || target <= monthIndex(period.endsOn));
    if (covers && (winner === null || period.startsOn > winner.startsOn)) winner = period;
  }
  return winner?.monthlyCents ?? 0;
}

function propertyMonth(input: PropertyCashFlowInput, month: MonthKey): PropertyMonth {
  const producesIncome = isIncomeProducing(input.usageType);
  const expected = input.occupancyRate / 100;

  let rent = 0;
  let reservations = 0;
  if (producesIncome) {
    switch (input.revenue.kind) {
      case "manual":
        rent = input.revenue.monthlyCents * expected;
        break;
      case "contracts":
        rent = contractRentIn(input.revenue.periods, month) * expected;
        break;
      case "reservations":
        reservations = input.revenue.reservations
          .filter((reservation) => reservation.checkIn.slice(0, 7) === month)
          .reduce((sum, reservation) => sum + reservation.totalCents, 0);
        break;
      case "none":
        break;
    }
  }

  let revenueTransactions = 0;
  let expenseTransactions = 0;
  for (const transaction of input.transactions) {
    if (!transactionOccursIn(transaction, month)) continue;
    if (transaction.signedAmountCents >= 0) revenueTransactions += transaction.signedAmountCents;
    else expenseTransactions += -transaction.signedAmountCents;
  }

  return { rent, reservations, revenueTransactions, fixed: input.annualExpensesCents / 12, expenseTransactions };
}

/**
 * Month-by-month revenue and expenses of a set of properties, for the months from `from` to `to`
 * (both included, empty months come out as zeros).
 *
 * - Rent: see `CashFlowRevenue`.
 * - Own use and loan for use produce no income. In the `portfolio` view they are left out entirely
 *   (rent, bookings, fixed expenses and transactions), exactly as `aggregatePortfolio` leaves them out
 *   of the portfolio income and expenses. In the `property` view the property is shown as it is: no
 *   rent or bookings, but its fixed expenses and transactions still count (as in the KPIs of one property).
 * - Bookings land in the month of the check-in.
 * - Fixed expenses are the annual expenses divided by 12, every month.
 * - Every amount of a property is weighted by its `share` (0-100, the ownership percentage) before
 *   properties are added, like the portfolio totals. Pass 100 to get the property as a whole.
 * - Amounts are added unrounded and rounded once per line and month, and each total is the sum of
 *   the rounded lines, so every figure in the answer adds up exactly.
 */
export function computeCashFlow(input: {
  from: MonthKey;
  to: MonthKey;
  /** `portfolio` adds properties that produce income; `property` reports whatever it is given, whatever its usage. */
  view: "portfolio" | "property";
  properties: ReadonlyArray<PropertyCashFlowInput & { share: number }>;
}): CashFlow {
  const months = monthRange(input.from, input.to).map((month): CashFlowMonth => {
    const sum: PropertyMonth = { rent: 0, reservations: 0, revenueTransactions: 0, fixed: 0, expenseTransactions: 0 };
    for (const property of input.properties) {
      if (input.view === "portfolio" && !isIncomeProducing(property.usageType)) continue;
      const amounts = propertyMonth(property, month);
      const weight = property.share / 100;
      sum.rent += amounts.rent * weight;
      sum.reservations += amounts.reservations * weight;
      sum.revenueTransactions += amounts.revenueTransactions * weight;
      sum.fixed += amounts.fixed * weight;
      sum.expenseTransactions += amounts.expenseTransactions * weight;
    }

    const revenue = {
      rentCents: Math.round(sum.rent),
      reservationsCents: Math.round(sum.reservations),
      transactionsCents: Math.round(sum.revenueTransactions),
    };
    const expenses = { fixedCents: Math.round(sum.fixed), transactionsCents: Math.round(sum.expenseTransactions) };
    const revenueTotal = revenue.rentCents + revenue.reservationsCents + revenue.transactionsCents;
    const expensesTotal = expenses.fixedCents + expenses.transactionsCents;

    return {
      month,
      revenue: { ...revenue, totalCents: revenueTotal },
      expenses: { ...expenses, totalCents: expensesTotal },
      netCents: revenueTotal - expensesTotal,
    };
  });

  const revenueCents = months.reduce((total, month) => total + month.revenue.totalCents, 0);
  const expensesCents = months.reduce((total, month) => total + month.expenses.totalCents, 0);
  return { from: input.from, to: input.to, months, totals: { revenueCents, expensesCents, netCents: revenueCents - expensesCents } };
}
