import { describe, expect, it } from "vitest";
import {
  aggregatePortfolio,
  buildCashFlows,
  computeIrr,
  computePropertyKpis,
  solveMonthlyRate,
  type PropertyKpiInput,
} from "../../src/modules/kpis/kpi-calculations.js";

/** Registers one test per check; the conditions are plain values, so they are evaluated at collection. */
const check = (name: string, cond: boolean, detail?: unknown) =>
  it(name, () => {
    expect(cond, detail === undefined ? name : JSON.stringify(detail)).toBe(true);
  });
const near = (a: number | null, b: number, eps = 1e-6) => a !== null && Math.abs(a - b) <= eps;

describe("property and portfolio KPIs", () => {
const manual: PropertyKpiInput = { usageType: "rental", ownershipPercentage: 100, estimatedValueCents: 60_000_000, annualExpensesCents: 600_000, occupancyRate: 90, rent: { kind: "nominal", monthlyCents: 300_000 } };
const k = computePropertyKpis(manual);
check("nominal revenue = rent x 12 x occupancy", k.annualRevenueCents === 3_240_000, k);
check("NOI = revenue - expenses", k.noiCents === 2_640_000, k);
check("gross yield = revenue / value", near(k.grossYield, 0.054), k);
check("cap rate = NOI / value", near(k.capRate, 0.044), k);
const realized = computePropertyKpis({ ...manual, rent: { kind: "realized", monthlyCents: 300_000 } });
check("realized revenue ignores the occupancy rate", realized.annualRevenueCents === 3_600_000, realized);
const vacant = computePropertyKpis({ ...manual, rent: { kind: "none" } });
check("vacant property: no revenue, negative NOI, zero yield", vacant.annualRevenueCents === 0 && vacant.noiCents === -600_000 && vacant.grossYield === 0 && near(vacant.capRate, -0.01), vacant);
const ownUse = computePropertyKpis({ ...manual, usageType: "own_use" });
check("own use: excluded, no income, no yields, still bears expenses", !ownUse.includedInPortfolio && ownUse.annualRevenueCents === 0 && ownUse.noiCents === -600_000 && ownUse.grossYield === null && ownUse.capRate === null, ownUse);
const loan = computePropertyKpis({ ...manual, usageType: "loan_for_use" });
check("loan for use is excluded too", !loan.includedInPortfolio && loan.capRate === null);
const noValue = computePropertyKpis({ ...manual, estimatedValueCents: null });
check("no estimated value: yields null, NOI still computed", noValue.grossYield === null && noValue.capRate === null && noValue.noiCents === 2_640_000, noValue);
check("zero estimated value: yields null", computePropertyKpis({ ...manual, estimatedValueCents: 0 }).capRate === null);
check("occupancy 0 -> no revenue", computePropertyKpis({ ...manual, occupancyRate: 0 }).annualRevenueCents === 0);

const rowA = { ownershipPercentage: 100, estimatedValueCents: 60_000_000, kpis: k };
const rowB = { ownershipPercentage: 50, estimatedValueCents: 40_000_000, kpis: computePropertyKpis({ ...manual, estimatedValueCents: 40_000_000, annualExpensesCents: 0, rent: { kind: "nominal", monthlyCents: 200_000 }, occupancyRate: 100 }) };
const rowOwn = { ownershipPercentage: 100, estimatedValueCents: 30_000_000, kpis: ownUse };
const rowNoValue = { ownershipPercentage: 100, estimatedValueCents: null, kpis: computePropertyKpis({ ...manual, estimatedValueCents: null }) };
const p = aggregatePortfolio([rowA, rowB, rowOwn, rowNoValue]);
// B: revenue 2.4M, NOI 2.4M, share 50% -> 1.2M each, value 20M
check("total value includes own use, weighted by share", p.totalValueCents === 60_000_000 + 20_000_000 + 30_000_000, p);
check("income-producing value excludes own use and value-less properties", p.incomeProducingValueCents === 80_000_000, p);
check("revenue is weighted and leaves out own use", p.annualRevenueCents === 3_240_000 + 1_200_000 + 3_240_000, p);
check("NOI sums all income-producing properties (weighted)", p.noiCents === 2_640_000 + 1_200_000 + 2_640_000, p);
check("portfolio cap rate only uses valued properties on both sides", near(p.capRate, (2_640_000 + 1_200_000) / 80_000_000), p);
check("portfolio gross yield", near(p.grossYield, (3_240_000 + 1_200_000) / 80_000_000), p);
const empty = aggregatePortfolio([]);
check("empty portfolio: zeros and null rates", empty.totalValueCents === 0 && empty.capRate === null && empty.grossYield === null, empty);
const onlyOwn = aggregatePortfolio([rowOwn]);
check("only own use: no rates", onlyOwn.capRate === null && onlyOwn.totalValueCents === 30_000_000, onlyOwn);

});

describe("IRR", () => {
const base = { acquiredOn: "2025-01-15", costCents: 10_000, estimatedValueCents: 11_000, operatingMonthlyCents: 0, transactions: [], asOf: "2026-01-20" };
const flat = computeIrr(base);
check("buy at 100, worth 110 after 12 months -> 10% a year", near(flat.annualRate, 0.1, 1e-5) && flat.months === 12, flat);
const flows = buildCashFlows(base);
check("cash flow has N+1 months, cost out and value back", flows.length === 13 && flows[0] === -10_000 && flows[12] === 11_000, flows);
const withRent = computeIrr({ ...base, operatingMonthlyCents: 100 });
check("operating income raises the IRR", withRent.annualRate !== null && withRent.annualRate > 0.1, withRent);
const solved = solveMonthlyRate(buildCashFlows({ ...base, operatingMonthlyCents: 100 }));
const residual = buildCashFlows({ ...base, operatingMonthlyCents: 100 }).reduce((s, f, t) => s + f / Math.pow(1 + solved!, t), 0);
check("the solved rate zeroes the NPV", Math.abs(residual) < 1e-6, residual);
const loss = computeIrr({ ...base, estimatedValueCents: 9_000 });
check("selling below cost with no income -> negative IRR", loss.annualRate !== null && loss.annualRate < 0 && near(loss.annualRate, -0.1, 1e-5), loss);
const oneOff = buildCashFlows({ ...base, transactions: [{ occurredOn: "2025-06-10", signedAmountCents: -500, isRecurring: false, recurrenceEndsOn: null }] });
check("a one-off transaction lands in its month", oneOff[5] === -500 && oneOff.filter((f, t) => t !== 0 && t !== 5 && t !== 12 && f !== 0).length === 0, oneOff);
const recurring = buildCashFlows({ ...base, transactions: [{ occurredOn: "2025-03-01", signedAmountCents: 10, isRecurring: true, recurrenceEndsOn: "2025-05-31" }] });
check("a recurring transaction repeats monthly until it ends", recurring[2] === 10 && recurring[3] === 10 && recurring[4] === 10 && recurring[1] === 0 && recurring[5] === 0, recurring);
const open = buildCashFlows({ ...base, transactions: [{ occurredOn: "2025-10-01", signedAmountCents: 10, isRecurring: true, recurrenceEndsOn: null }] });
check("an open-ended recurrence runs to the end of the period", open[9] === 10 && open[12] === 11_010, open);
const before = buildCashFlows({ ...base, transactions: [{ occurredOn: "2024-01-01", signedAmountCents: 77, isRecurring: false, recurrenceEndsOn: null }] });
check("transactions before the acquisition are ignored", before.every((f, t) => (t === 0 ? f === -10_000 : t === 12 ? f === 11_000 : f === 0)), before);
const recurringFromBefore = buildCashFlows({ ...base, transactions: [{ occurredOn: "2024-11-01", signedAmountCents: 5, isRecurring: true, recurrenceEndsOn: "2025-03-01" }] });
check("a recurrence that started before the acquisition counts from the acquisition month", recurringFromBefore[0] === -9_995 && recurringFromBefore[2] === 5 && recurringFromBefore[3] === 0, recurringFromBefore);
const future = buildCashFlows({ ...base, transactions: [{ occurredOn: "2030-01-01", signedAmountCents: 99, isRecurring: false, recurrenceEndsOn: null }] });
check("transactions after the period are ignored", future.every((f, t) => (t === 0 ? f === -10_000 : t === 12 ? f === 11_000 : f === 0)), future);

check("no acquisition date -> unavailable", computeIrr({ ...base, acquiredOn: null }).unavailableReason === "no_acquisition_date");
check("no cost -> unavailable", computeIrr({ ...base, costCents: null }).unavailableReason === "no_acquisition_cost");
check("zero cost -> unavailable", computeIrr({ ...base, costCents: 0 }).unavailableReason === "no_acquisition_cost");
check("no value -> unavailable", computeIrr({ ...base, estimatedValueCents: null }).unavailableReason === "no_estimated_value");
check("same month as the acquisition -> period too short", computeIrr({ ...base, asOf: "2025-01-31" }).unavailableReason === "period_too_short");
check("as-of before the acquisition -> period too short", computeIrr({ ...base, asOf: "2024-06-01" }).unavailableReason === "period_too_short");
check("one month is enough", computeIrr({ ...base, asOf: "2025-02-01" }).annualRate !== null);
check("flows that never change sign have no solution", solveMonthlyRate([-100, -50, -10]) === null && solveMonthlyRate([100, 50]) === null);
const longRun = computeIrr({ ...base, acquiredOn: "2006-01-01", costCents: 5_000_000, estimatedValueCents: 60_000_000, operatingMonthlyCents: 30_000, asOf: "2026-11-03" });
check("long period with income converges to a sane rate", longRun.annualRate !== null && longRun.annualRate > 0.05 && longRun.annualRate < 0.5, longRun);
});
