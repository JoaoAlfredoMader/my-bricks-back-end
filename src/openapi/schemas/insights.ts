import { z } from "zod";
import { AmortizationSystem, UsageType } from "../../generated/prisma/enums.js";
import type { PortfolioKpisDto, PropertyKpisDto } from "../../modules/kpis/kpis.dto.js";
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
