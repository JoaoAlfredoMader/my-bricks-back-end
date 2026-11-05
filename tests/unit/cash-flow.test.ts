import { describe, expect, it } from "vitest";
import {
  buildCashFlows,
  computeCashFlow,
  countMonths,
  monthRange,
  transactionOccursIn,
  type PropertyCashFlowInput,
} from "../../src/modules/kpis/kpi-calculations.js";

/** Registers one test per check; the conditions are plain values, so they are evaluated at collection. */
const check = (name: string, cond: boolean, detail?: unknown) =>
  it(name, () => {
    expect(cond, detail === undefined ? name : JSON.stringify(detail)).toBe(true);
  });

const tx = (signedAmountCents: number, occurredOn: string, recurrenceEndsOn: string | null = null, isRecurring = recurrenceEndsOn !== null) => ({
  signedAmountCents,
  occurredOn,
  isRecurring,
  recurrenceEndsOn,
});

const base: PropertyCashFlowInput = {
  usageType: "rental",
  occupancyRate: 100,
  annualExpensesCents: 0,
  revenue: { kind: "none" },
  transactions: [],
};
const flow = (properties: Array<PropertyCashFlowInput & { share?: number }>, from = "2026-01", to = "2026-03", view: "portfolio" | "property" = "portfolio") =>
  computeCashFlow({ from, to, view, properties: properties.map((property) => ({ share: 100, ...property })) });

describe("months", () => {
  check("a window is every month from `from` to `to`, both included", monthRange("2026-01", "2026-03").join() === "2026-01,2026-02,2026-03");
  check("a one-month window", monthRange("2026-05", "2026-05").join() === "2026-05");
  check("it crosses the year", monthRange("2025-11", "2026-02").join() === "2025-11,2025-12,2026-01,2026-02");
  check("it can be counted", countMonths("2026-01", "2026-12") === 12 && countMonths("2024-01", "2026-12") === 36 && countMonths("2026-03", "2026-01") === -1);
  check("a window that ends before it starts has no months", monthRange("2026-03", "2026-01").length === 0);
});

describe("which months a transaction lands in", () => {
  const months = monthRange("2025-12", "2026-06");
  const where = (transaction: ReturnType<typeof tx>) => months.filter((month) => transactionOccursIn(transaction, month)).join();
  check("one-off: only the month it occurred in", where(tx(100, "2026-02-10")) === "2026-02");
  check("recurring without end: every month from the first one on", where(tx(100, "2026-02-10", null, true)) === "2026-02,2026-03,2026-04,2026-05,2026-06");
  check("recurring with an end: until the month of the end, inclusive", where(tx(100, "2026-02-10", "2026-04-01")) === "2026-02,2026-03,2026-04");
  check("the end counts by month, whatever the day", where(tx(100, "2026-02-10", "2026-04-30")) === "2026-02,2026-03,2026-04");
  check("recurring that ends in its first month lands once", where(tx(100, "2026-02-10", "2026-02-10")) === "2026-02");
  check("recurring that started before the window", where(tx(100, "2021-03-10", null, true)) === months.join());

  // Same criterion as the IRR cash flow, so the two can never drift apart.
  const transactions = [tx(100, "2026-02-10"), tx(-250, "2026-01-05", null, true), tx(80, "2026-02-01", "2026-04-20"), tx(-9, "2025-12-01", "2026-01-31")];
  const flows = buildCashFlows({ acquiredOn: "2026-01-01", costCents: 0, estimatedValueCents: 0, operatingMonthlyCents: 0, transactions, asOf: "2026-06-01" });
  const window = monthRange("2026-01", "2026-06");
  check(
    "it matches the monthly cash flow the IRR is built from",
    window.every((month, t) => transactions.reduce((sum, transaction) => sum + (transactionOccursIn(transaction, month) ? transaction.signedAmountCents : 0), 0) === flows[t]),
    { flows },
  );
});

describe("the monthly cash flow", () => {
  const house: PropertyCashFlowInput = {
    ...base,
    annualExpensesCents: 120_000,
    revenue: { kind: "manual", monthlyCents: 300_000 },
    transactions: [
      tx(-25_000, "2025-11-05", null, true), // recurring expense with no end, started before the window
      tx(8_000, "2026-01-15", "2026-02-20"), // recurring revenue that ends in the middle of the window
      tx(50_000, "2026-03-10"), // one-off revenue
      tx(-7_000, "2026-02-02"), // one-off expense
    ],
  };
  const result = flow([house]);
  const [jan, feb, mar] = result.months;

  check("one item per month of the window, in order, with the window echoed", result.months.map((month) => month.month).join() === "2026-01,2026-02,2026-03" && result.from === "2026-01" && result.to === "2026-03");
  check("rent: the typed rent every month", [jan, feb, mar].every((month) => month!.revenue.rentCents === 300_000));
  check("fixed expenses: the annual expenses divided by 12", [jan, feb, mar].every((month) => month!.expenses.fixedCents === 10_000));
  check("recurring with no end: charged in every month of the window", [jan, feb, mar].every((month) => month!.expenses.transactionsCents >= 25_000));
  check("recurring that ends in the middle: January and February, not March", jan!.revenue.transactionsCents === 8_000 && feb!.revenue.transactionsCents === 8_000 && mar!.revenue.transactionsCents === 50_000);
  check("one-off lands only in its month", feb!.expenses.transactionsCents === 32_000 && jan!.expenses.transactionsCents === 25_000 && mar!.expenses.transactionsCents === 25_000);
  check("total revenue is rent + bookings + transactions", jan!.revenue.totalCents === 308_000 && feb!.revenue.totalCents === 308_000 && mar!.revenue.totalCents === 350_000, result.months.map((month) => month.revenue));
  check("total expenses is fixed + transactions", jan!.expenses.totalCents === 35_000 && feb!.expenses.totalCents === 42_000 && mar!.expenses.totalCents === 35_000);
  check("net = revenue - expenses", jan!.netCents === 273_000 && feb!.netCents === 266_000 && mar!.netCents === 315_000);
  check("totals are the sums of the months", result.totals.revenueCents === 308_000 + 308_000 + 350_000 && result.totals.expensesCents === 112_000 && result.totals.netCents === 854_000, result.totals);

  const empty = flow([base], "2026-01", "2026-02");
  const zeros = { revenue: { rentCents: 0, reservationsCents: 0, transactionsCents: 0, totalCents: 0 }, expenses: { fixedCents: 0, transactionsCents: 0, totalCents: 0 }, netCents: 0 };
  check("a month with nothing in it is all zeros", empty.months.length === 2 && empty.months.every(({ month, ...amounts }) => JSON.stringify(amounts) === JSON.stringify(zeros)), empty.months);
  check("no properties at all: zeros, the months are still there", flow([], "2026-01", "2026-12").months.length === 12 && flow([]).totals.netCents === 0);
  check("a window outside every transaction: only the fixed expenses and rent remain", flow([house], "2030-01", "2030-01").months[0]!.expenses.transactionsCents === 25_000, flow([house], "2030-01", "2030-01").months[0]);
});

describe("ownership share", () => {
  const whole: PropertyCashFlowInput = { ...base, annualExpensesCents: 120_000, revenue: { kind: "manual", monthlyCents: 200_000 }, transactions: [tx(-10_000, "2026-01-10"), tx(4_000, "2026-01-20")] };
  const full = flow([{ ...whole, share: 100 }], "2026-01", "2026-01").months[0]!;
  const half = flow([{ ...whole, share: 50 }], "2026-01", "2026-01").months[0]!;
  check("a half share halves every line", half.revenue.rentCents === full.revenue.rentCents / 2 && half.revenue.transactionsCents === full.revenue.transactionsCents / 2 && half.expenses.fixedCents === full.expenses.fixedCents / 2 && half.expenses.transactionsCents === full.expenses.transactionsCents / 2, { full, half });
  check("a half share: the exact figures", half.revenue.totalCents === 102_000 && half.expenses.totalCents === 10_000 && half.netCents === 92_000, half);

  const other: PropertyCashFlowInput = { ...base, revenue: { kind: "manual", monthlyCents: 100_000 } };
  const both = flow([{ ...whole, share: 50 }, { ...other, share: 100 }], "2026-01", "2026-01").months[0]!;
  check("properties are weighted one by one and then added", both.revenue.rentCents === 100_000 + 100_000 && both.revenue.totalCents === 202_000, both);
  check("a zero share contributes nothing", flow([{ ...whole, share: 0 }], "2026-01", "2026-01").months[0]!.netCents === 0);
});

describe("revenue sources", () => {
  check("the occupancy rate applies to a manual rent", flow([{ ...base, occupancyRate: 90, revenue: { kind: "manual", monthlyCents: 300_000 } }]).months[0]!.revenue.rentCents === 270_000);

  const contracts: PropertyCashFlowInput = {
    ...base,
    occupancyRate: 100,
    revenue: {
      kind: "contracts",
      periods: [
        { monthlyCents: 200_000, startsOn: "2025-10-01", endsOn: "2026-03-01" }, // replaced on March 1st
        { monthlyCents: 250_000, startsOn: "2026-03-01", endsOn: null },
      ],
    },
  };
  const replaced = flow([contracts], "2026-01", "2026-04").months.map((month) => month.revenue.rentCents);
  check("a contract counts from its first to its last month; the replacement wins the month it starts, with no double count", replaced.join() === "200000,200000,250000,250000", replaced);
  check("no contract in force in a month: no rent", flow([contracts], "2025-08", "2025-09").months.every((month) => month.revenue.rentCents === 0));
  check("the occupancy rate applies to contract rent too", flow([{ ...contracts, occupancyRate: 80 }], "2026-01", "2026-01").months[0]!.revenue.rentCents === 160_000);
  check("a contract that ended counts through the month it ended", flow([{ ...base, revenue: { kind: "contracts", periods: [{ monthlyCents: 100_000, startsOn: "2026-01-10", endsOn: "2026-02-15" }] } }]).months.map((month) => month.revenue.rentCents).join() === "100000,100000,0");

  const stays: PropertyCashFlowInput = {
    ...base,
    usageType: "short_stay",
    occupancyRate: 50,
    revenue: {
      kind: "reservations",
      reservations: [
        { checkIn: "2026-01-30", totalCents: 90_000 }, // check-out in February: still all January
        { checkIn: "2026-01-05", totalCents: 10_000 },
        { checkIn: "2026-03-01", totalCents: 40_000 },
      ],
    },
  };
  const booked = flow([stays]).months.map((month) => month.revenue.reservationsCents);
  check("bookings land in the month of the check-in, in full, and the occupancy rate does not apply", booked.join() === "100000,0,40000", booked);
  check("bookings are not rent", flow([stays]).months.every((month) => month.revenue.rentCents === 0));

  const ownUse: PropertyCashFlowInput = { ...base, usageType: "own_use", annualExpensesCents: 60_000, revenue: { kind: "manual", monthlyCents: 100_000 }, transactions: [tx(-3_000, "2026-01-10")] };
  const own = flow([ownUse], "2026-01", "2026-01", "property").months[0]!;
  check("one own-use property asked for by itself: no income, but its fixed expenses and transactions show", own.revenue.totalCents === 0 && own.expenses.fixedCents === 5_000 && own.expenses.transactionsCents === 3_000 && own.netCents === -8_000, own);
  check("one loan-for-use property asked for by itself shows its expenses too", flow([{ ...ownUse, usageType: "loan_for_use" }], "2026-01", "2026-01", "property").months[0]!.expenses.totalCents === 8_000);

  const rented: PropertyCashFlowInput = { ...base, annualExpensesCents: 120_000, revenue: { kind: "manual", monthlyCents: 200_000 }, occupancyRate: 100, transactions: [tx(-10_000, "2026-01-10")] };
  const alone = flow([rented], "2026-01", "2026-01");
  const withOwnUse = flow([rented, ownUse, { ...ownUse, usageType: "loan_for_use" }], "2026-01", "2026-01");
  check("in the portfolio, own use and loan for use are left out entirely: they change no line and no total", JSON.stringify(withOwnUse) === JSON.stringify(alone) && withOwnUse.totals.expensesCents === 20_000, withOwnUse);
  check("a portfolio made only of own-use properties is all zeros", flow([ownUse], "2026-01", "2026-01").totals.expensesCents === 0 && flow([ownUse], "2026-01", "2026-01").months[0]!.netCents === 0);
  check("in the property view an income-producing property is unchanged", JSON.stringify(flow([rented], "2026-01", "2026-01", "property")) === JSON.stringify(alone));
});

describe("rounding", () => {
  const odd: PropertyCashFlowInput = { ...base, annualExpensesCents: 100_000, revenue: { kind: "manual", monthlyCents: 100_001 } };
  const result = flow([odd], "2026-01", "2026-12");
  check("amounts are integer cents", result.months.every((month) => [month.revenue.rentCents, month.expenses.fixedCents, month.netCents].every(Number.isInteger)));
  check("a month's fixed expenses are rounded to the cent", result.months[0]!.expenses.fixedCents === 8_333);
  check("every total is exactly the sum of its parts", result.months.every((month) => month.revenue.totalCents === month.revenue.rentCents + month.revenue.reservationsCents + month.revenue.transactionsCents && month.expenses.totalCents === month.expenses.fixedCents + month.expenses.transactionsCents && month.netCents === month.revenue.totalCents - month.expenses.totalCents));
  check("a share that splits a cent is rounded once, after adding the properties", flow([{ ...base, share: 50, revenue: { kind: "manual", monthlyCents: 101 } }, { ...base, share: 50, revenue: { kind: "manual", monthlyCents: 101 } }], "2026-01", "2026-01").months[0]!.revenue.rentCents === 101);
});
