import { describe, expect, it } from "vitest";
import { type FinancingTerms, buildSchedule, summarize } from "../../src/modules/properties/financing-schedule.js";

const price: FinancingTerms = {
  financedAmountCents: 10_000_000,
  termMonths: 12,
  annualInterestRate: 12,
  amortizationSystem: "price",
  firstInstallmentOn: "2026-01-10",
};
const sac: FinancingTerms = { ...price, financedAmountCents: 1_200_000, amortizationSystem: "sac" };

describe("Price schedule", () => {
  const rows = buildSchedule(price);

  it("has one row per month, numbered from 1", () => {
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.number)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it("charges the monthly rate on the first balance", () => {
    expect(rows[0]!.interestCents).toBe(100_000);
  });

  it("keeps the installment constant (within a cent) until the last one", () => {
    const installments = rows.slice(0, 11).map((row) => row.installmentCents);
    expect(Math.max(...installments) - Math.min(...installments)).toBeLessThanOrEqual(1);
    expect(installments[0]).toBeGreaterThanOrEqual(888_487);
    expect(installments[0]).toBeLessThanOrEqual(888_489);
  });

  it("amortizes exactly the financed amount and ends at zero", () => {
    expect(rows.reduce((sum, row) => sum + row.amortizationCents, 0)).toBe(10_000_000);
    expect(rows.at(-1)!.balanceCents).toBe(0);
  });

  it("amortizes more and charges less interest over time", () => {
    expect(rows[1]!.amortizationCents).toBeGreaterThan(rows[0]!.amortizationCents);
    expect(rows[1]!.interestCents).toBeLessThan(rows[0]!.interestCents);
  });

  it("each row adds up: installment = interest + amortization", () => {
    for (const row of rows) expect(row.installmentCents).toBe(row.interestCents + row.amortizationCents);
  });
});

describe("SAC schedule", () => {
  const rows = buildSchedule(sac);

  it("amortizes the same amount every month", () => {
    expect(rows.slice(0, 11).every((row) => row.amortizationCents === 100_000)).toBe(true);
  });

  it("starts with the highest installment and ends with the lowest", () => {
    expect(rows[0]!.installmentCents).toBe(112_000);
    expect(rows.at(-1)!.installmentCents).toBe(101_000);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.installmentCents).toBeLessThan(rows[i - 1]!.installmentCents);
  });

  it("ends at zero", () => {
    expect(rows.at(-1)!.balanceCents).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.amortizationCents, 0)).toBe(1_200_000);
  });
});

describe("edge cases", () => {
  it("zero interest splits the principal evenly", () => {
    const rows = buildSchedule({ ...price, annualInterestRate: 0 });
    expect(rows.every((row) => row.interestCents === 0)).toBe(true);
    expect(rows.slice(0, 11).every((row) => row.installmentCents === Math.round(10_000_000 / 12))).toBe(true);
    expect(rows.at(-1)!.balanceCents).toBe(0);
  });

  it("a single installment pays everything plus one month of interest", () => {
    const [row] = buildSchedule({ ...price, termMonths: 1 });
    expect(row).toMatchObject({ number: 1, interestCents: 100_000, amortizationCents: 10_000_000, balanceCents: 0 });
  });

  it("the last installment absorbs the rounding", () => {
    const rows = buildSchedule({ ...sac, financedAmountCents: 100, termMonths: 3, annualInterestRate: 0 });
    expect(rows.map((row) => row.amortizationCents)).toEqual([33, 33, 34]);
  });

  it("a 35-year financing converges to zero", () => {
    const rows = buildSchedule({ ...price, financedAmountCents: 80_000_000, termMonths: 420, annualInterestRate: 11.49 });
    expect(rows).toHaveLength(420);
    expect(rows.at(-1)!.balanceCents).toBe(0);
    expect(rows.every((row) => row.balanceCents >= 0)).toBe(true);
  });
});

describe("due dates", () => {
  it("fall on the same day of each month", () => {
    const rows = buildSchedule(price);
    expect(rows[0]!.dueOn).toBe("2026-01-10");
    expect(rows[1]!.dueOn).toBe("2026-02-10");
    expect(rows[11]!.dueOn).toBe("2026-12-10");
  });

  it("roll into the next year", () => {
    const rows = buildSchedule({ ...price, termMonths: 14 });
    expect(rows[12]!.dueOn).toBe("2027-01-10");
    expect(rows[13]!.dueOn).toBe("2027-02-10");
  });

  it("clamp the 31st to the end of shorter months and come back", () => {
    const rows = buildSchedule({ ...price, firstInstallmentOn: "2026-01-31", termMonths: 4 });
    expect(rows.map((row) => row.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("honor leap years", () => {
    const rows = buildSchedule({ ...price, firstInstallmentOn: "2027-12-31", termMonths: 3 });
    expect(rows.map((row) => row.dueOn)).toEqual(["2027-12-31", "2028-01-31", "2028-02-29"]);
  });
});

describe("summary", () => {
  const rows = buildSchedule(price);

  it("before the first due date nothing is paid and everything is owed", () => {
    const summary = summarize(rows, 10_000_000, "2025-12-31");
    expect(summary).toMatchObject({ paidInstallments: 0, remainingInstallments: 12, outstandingBalanceCents: 10_000_000, totalPaidCents: 0 });
    expect(summary.nextInstallment?.number).toBe(1);
  });

  it("an installment counts as paid on its due date", () => {
    const summary = summarize(rows, 10_000_000, "2026-03-10");
    expect(summary.paidInstallments).toBe(3);
    expect(summary.remainingInstallments).toBe(9);
    expect(summary.outstandingBalanceCents).toBe(rows[2]!.balanceCents);
    expect(summary.totalPaidCents).toBe(rows[0]!.installmentCents + rows[1]!.installmentCents + rows[2]!.installmentCents);
    expect(summary.nextInstallment?.number).toBe(4);
  });

  it("the day before a due date it is not paid yet", () => {
    expect(summarize(rows, 10_000_000, "2026-03-09").paidInstallments).toBe(2);
  });

  it("after the last installment nothing is owed", () => {
    const summary = summarize(rows, 10_000_000, "2030-01-01");
    expect(summary).toMatchObject({ paidInstallments: 12, remainingInstallments: 0, outstandingBalanceCents: 0, nextInstallment: null });
  });

  it("total interest is the sum over the whole schedule", () => {
    const summary = summarize(rows, 10_000_000, "2026-03-10");
    expect(summary.totalInterestCents).toBe(rows.reduce((sum, row) => sum + row.interestCents, 0));
    expect(summary.totalInterestCents).toBeGreaterThan(0);
  });
});
