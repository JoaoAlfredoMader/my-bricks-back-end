import type { AmortizationSystem } from "../../generated/prisma/enums.js";

/**
 * Pure amortization maths for a property financing: no database, no HTTP. Amounts are integer
 * cents. The nominal annual rate (in percent) is split evenly into a monthly rate.
 */

export interface FinancingTerms {
  financedAmountCents: number;
  termMonths: number;
  /** Nominal rate per year, in percent (10.5 = 10.5% a year). */
  annualInterestRate: number;
  amortizationSystem: AmortizationSystem;
  /** `YYYY-MM-DD`: the due date of installment 1. Later ones fall on the same day of each month. */
  firstInstallmentOn: string;
}

export interface Installment {
  number: number;
  dueOn: string;
  installmentCents: number;
  interestCents: number;
  amortizationCents: number;
  /** What is still owed right after this installment is paid. */
  balanceCents: number;
}

export interface FinancingSummary {
  paidInstallments: number;
  remainingInstallments: number;
  /** Owed right after the last installment due on or before `asOf`. */
  outstandingBalanceCents: number;
  totalPaidCents: number;
  totalInterestCents: number;
  nextInstallment: Installment | null;
}

/** `YYYY-MM-DD` of installment `index` (0-based), clamping the day to the length of the month. */
function dueDate(firstInstallmentOn: string, index: number): string {
  const year = Number(firstInstallmentOn.slice(0, 4));
  const month = Number(firstInstallmentOn.slice(5, 7)) - 1;
  const day = Number(firstInstallmentOn.slice(8, 10));

  const target = month + index;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, daysInMonth))}`;
}

/** The whole schedule. Rounding is done per row and the last amortization absorbs the difference. */
export function buildSchedule(terms: FinancingTerms): Installment[] {
  const { financedAmountCents: principal, termMonths: months, amortizationSystem } = terms;
  const monthlyRate = terms.annualInterestRate / 100 / 12;

  // Price: constant installment. SAC: constant amortization.
  const priceInstallment =
    monthlyRate === 0 ? principal / months : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));

  const rows: Installment[] = [];
  let balance = principal;
  for (let number = 1; number <= months; number++) {
    const interest = Math.round(balance * monthlyRate);
    let amortization =
      amortizationSystem === "sac" ? Math.round(principal / months) : Math.round(priceInstallment) - interest;
    // The last installment settles whatever the rounding left over.
    if (number === months) amortization = balance;

    balance -= amortization;
    rows.push({
      number,
      dueOn: dueDate(terms.firstInstallmentOn, number - 1),
      installmentCents: amortization + interest,
      interestCents: interest,
      amortizationCents: amortization,
      balanceCents: balance,
    });
  }
  return rows;
}

/** Where the financing stands on `asOf` (`YYYY-MM-DD`): an installment counts as paid once its due date has come. */
export function summarize(schedule: readonly Installment[], principalCents: number, asOf: string): FinancingSummary {
  const paid = schedule.filter((row) => row.dueOn <= asOf);
  const last = paid.at(-1);
  return {
    paidInstallments: paid.length,
    remainingInstallments: schedule.length - paid.length,
    outstandingBalanceCents: last ? last.balanceCents : principalCents,
    totalPaidCents: paid.reduce((sum, row) => sum + row.installmentCents, 0),
    totalInterestCents: schedule.reduce((sum, row) => sum + row.interestCents, 0),
    nextInstallment: schedule[paid.length] ?? null,
  };
}
