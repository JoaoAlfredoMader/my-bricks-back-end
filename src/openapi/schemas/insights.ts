import { z } from "zod";
import { AmortizationSystem, UsageType } from "../../generated/prisma/enums.js";
import type { CashFlowDto, PortfolioKpisDto, PropertyKpisDto } from "../../modules/kpis/kpis.dto.js";
import type { FinancingScheduleDto } from "../../modules/properties/properties.dto.js";
import { cents, date, nullable, output } from "./common.js";
import { propertyStatusSchema } from "./entities.js";

const rate = (description: string) => nullable(z.number()).describe(description);

export const propertyKpisSchema = output(
  "PropertyKpis",
  z.object({
    propertyId: z.uuid(),
    name: z.string(),
    clientId: nullable(z.string()),
    usageType: z.enum(UsageType),
    status: propertyStatusSchema,
    ownershipPercentage: z.number(),
    estimatedValueCents: nullable(cents),
    revenueSource: z
      .enum(["manual", "contract", "reservations", "none"])
      .describe("Where the revenue comes from: the rent typed on the property, the active contract, or the last 12 months of bookings"),
    monthlyRentCents: cents.describe("Monthly rent, or the monthly average of the last 12 months of bookings"),
    includedInPortfolio: z.boolean().describe("Own use and loan for use produce no income and stay out of yields and portfolio income"),
    annualRevenueCents: cents,
    annualExpensesCents: cents,
    noiCents: cents.describe("Net operating income per year: revenue minus expenses"),
    grossYield: rate("Annual revenue / estimated value, as a fraction (0.07 = 7%). null without a value"),
    capRate: rate("NOI / estimated value, as a fraction. null without a value"),
    irr: z.object({
      annualRate: rate("Annualized IRR as a fraction. null when it cannot be computed"),
      unavailableReason: nullable(z.enum(["no_acquisition_date", "no_acquisition_cost", "no_estimated_value", "period_too_short", "no_solution"])),
      months: nullable(z.number().int()).describe("Months between the acquisition and `asOf`"),
    }),
  }) satisfies z.ZodType<PropertyKpisDto>,
);

export const portfolioKpisSchema = output(
  "PortfolioKpis",
  z.object({
    asOf: date,
    totals: z.object({
      totalValueCents: cents.describe("Estimated value of every property with a value, weighted by ownership share"),
      incomeProducingValueCents: cents.describe("The part of it that produces income: the base of the portfolio yield and cap rate"),
      annualRevenueCents: cents,
      annualExpensesCents: cents,
      noiCents: cents,
      grossYield: rate("Revenue / value over the income-producing properties that have a value"),
      capRate: rate("NOI / value over the income-producing properties that have a value"),
    }),
    propertyCount: z.number().int(),
    propertiesByStatus: z.object({
      own_use: z.number().int(),
      loan_for_use: z.number().int(),
      rented: z.number().int(),
      vacant: z.number().int(),
    }),
    properties: z.array(propertyKpisSchema),
  }) satisfies z.ZodType<PortfolioKpisDto>,
);

const month = z.string().describe("Calendar month, YYYY-MM");

export const cashFlowSchema = output(
  "CashFlow",
  z.object({
    from: month,
    to: month,
    months: z
      .array(
        z.object({
          month,
          revenue: z.object({
            rentCents: cents.describe(
              "Rent in force that month: the typed rent (manual mode) or the conventional contract in force (contract mode), times the expected occupancy rate. Zero for short-stay properties, whose income is the bookings",
            ),
            reservationsCents: cents.describe(
              "Confirmed bookings of short-stay properties, in full in the month of the check-in (no spreading over the nights; the occupancy rate does not apply)",
            ),
            transactionsCents: cents.describe("Revenue transactions: one-off ones in their month, recurring ones in every month until the month of their end, inclusive"),
            totalCents: cents.describe("rentCents + reservationsCents + transactionsCents"),
          }),
          expenses: z.object({
            fixedCents: cents.describe("The annual expenses of the property divided by 12, the same amount every month (rounded to the cent). Own use and loan for use appear only when a single property is asked for; the portfolio leaves them out"),
            transactionsCents: cents.describe("Expense transactions, with the same month rules as the revenue ones. Financing installments recorded as transactions are here"),
            totalCents: cents.describe("fixedCents + transactionsCents"),
          }),
          netCents: cents.describe("Revenue minus expenses of the month (negative when expenses are larger)"),
        }),
      )
      .describe("One item per month of the window, in order, including months with nothing (all zeros)"),
    totals: z.object({
      revenueCents: cents.describe("Sum of the monthly total revenue"),
      expensesCents: cents.describe("Sum of the monthly total expenses"),
      netCents: cents.describe("revenueCents - expensesCents"),
    }),
  }) satisfies z.ZodType<CashFlowDto>,
);

const installmentSchema = z.object({
  number: z.number().int(),
  dueOn: date,
  installmentCents: cents,
  interestCents: cents,
  amortizationCents: cents,
  balanceCents: cents.describe("What is still owed right after this installment is paid"),
});

export const financingScheduleSchema = output(
  "FinancingSchedule",
  z.object({
    asOf: date,
    amortizationSystem: z.enum(AmortizationSystem),
    financedAmountCents: cents,
    termMonths: z.number().int(),
    annualInterestRate: z.number().describe("Nominal rate per year, in percent"),
    summary: z.object({
      paidInstallments: z.number().int(),
      remainingInstallments: z.number().int(),
      outstandingBalanceCents: cents,
      totalPaidCents: cents,
      totalInterestCents: cents,
      nextInstallment: nullable(installmentSchema),
    }),
    installments: z.array(installmentSchema),
  }) satisfies z.ZodType<FinancingScheduleDto>,
);
