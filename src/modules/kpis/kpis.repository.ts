import type { Prisma } from "../../generated/prisma/client.js";
import type { ContractStatus, ContractType, RentalMode, TransactionType, UsageType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { transactionPeriodFilter } from "../transactions/transaction-period.js";

const select = {
  id: true,
  name: true,
  clientId: true,
  usageType: true,
  rentalMode: true,
  ownershipPercentage: true,
  estimatedValueCents: true,
  annualExpensesCents: true,
  occupancyRate: true,
  manualRental: { select: { tenantName: true, monthlyRentCents: true } },
  acquisition: { select: { acquiredOn: true, costCents: true } },
  contracts: {
    where: { status: "active" },
    select: { contractType: true, rentTerms: { select: { monthlyRentCents: true } } },
    take: 1,
  },
  transactions: {
    select: {
      amountCents: true,
      occurredOn: true,
      isRecurring: true,
      recurrenceEndsOn: true,
      category: { select: { transactionType: true } },
    },
  },
} satisfies Prisma.PropertySelect;

type PropertyRow = Prisma.PropertyGetPayload<{ select: typeof select }>;

/** Everything the KPI calculations need about one property, read in a single go. */
export interface PropertyKpiRecord {
  id: string;
  name: string;
  clientId: string | null;
  usageType: UsageType;
  rentalMode: RentalMode;
  ownershipPercentage: number;
  estimatedValueCents: bigint | null;
  annualExpensesCents: bigint;
  occupancyRate: number;
  manualRental: { tenantName: string | null; monthlyRentCents: bigint } | null;
  acquisition: { acquiredOn: Date | null; costCents: bigint | null } | null;
  activeContract: { contractType: ContractType; monthlyRentCents: bigint | null } | null;
  /** Sum of the confirmed reservations whose check-in falls in the window. */
  reservationsTotalCents: bigint;
  transactions: Array<{
    amountCents: bigint;
    occurredOn: Date;
    isRecurring: boolean;
    recurrenceEndsOn: Date | null;
    transactionType: TransactionType;
  }>;
}

/** Every query is bound to one organization; members only reach properties they created. */
export interface KpiScope {
  organizationId: string;
  createdById?: string;
}

export interface KpiQuery {
  propertyId?: string;
  clientId?: string;
  /** Reservations with check-in in `[reservationsFrom, reservationsTo]` count as realized revenue. */
  reservationsFrom: Date;
  reservationsTo: Date;
}

/** Everything the monthly cash flow needs about one property, already narrowed to the window. */
export interface CashFlowPropertyRecord {
  id: string;
  usageType: UsageType;
  rentalMode: RentalMode;
  ownershipPercentage: number;
  annualExpensesCents: bigint;
  occupancyRate: number;
  manualMonthlyRentCents: bigint | null;
  /** Conventional contracts that are not cancelled and may reach the window. */
  contracts: Array<{ status: ContractStatus; startDate: Date; endDate: Date | null; updatedAt: Date; monthlyRentCents: bigint }>;
  /** Confirmed reservations with check-in inside the window. */
  reservations: Array<{ checkIn: Date; totalAmountCents: bigint }>;
  /** One-off transactions inside the window and recurring ones whose occurrences touch it. */
  transactions: PropertyKpiRecord["transactions"];
}

export interface CashFlowQuery {
  propertyId?: string;
  /** First and last day of the window; whole months, both included. */
  from: Date;
  to: Date;
}

export interface KpisRepository {
  loadProperties(scope: KpiScope, query: KpiQuery): Promise<PropertyKpiRecord[]>;
  loadCashFlow(scope: KpiScope, query: CashFlowQuery): Promise<CashFlowPropertyRecord[]>;
}

function toRecord(row: PropertyRow, reservationsTotalCents: bigint): PropertyKpiRecord {
  const [contract] = row.contracts;
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    usageType: row.usageType,
    rentalMode: row.rentalMode,
    ownershipPercentage: row.ownershipPercentage.toNumber(),
    estimatedValueCents: row.estimatedValueCents,
    annualExpensesCents: row.annualExpensesCents,
    occupancyRate: row.occupancyRate.toNumber(),
    manualRental: row.manualRental,
    acquisition: row.acquisition,
    activeContract: contract
      ? { contractType: contract.contractType, monthlyRentCents: contract.rentTerms?.monthlyRentCents ?? null }
      : null,
    reservationsTotalCents,
    transactions: row.transactions.map(({ category, ...transaction }) => ({
      ...transaction,
      transactionType: category.transactionType,
    })),
  };
}

const cashFlowSelect = ({ from, to }: Pick<CashFlowQuery, "from" | "to">) =>
  ({
    id: true,
    usageType: true,
    rentalMode: true,
    ownershipPercentage: true,
    annualExpensesCents: true,
    occupancyRate: true,
    manualRental: { select: { monthlyRentCents: true } },
    contracts: {
      where: {
        contractType: "conventional",
        status: { not: "cancelled" },
        startDate: { lte: to },
        OR: [{ endDate: null }, { endDate: { gte: from } }],
      },
      select: { status: true, startDate: true, endDate: true, updatedAt: true, rentTerms: { select: { monthlyRentCents: true } } },
    },
    reservations: {
      where: { status: "confirmed", checkIn: { gte: from, lte: to } },
      select: { checkIn: true, totalAmountCents: true },
    },
    transactions: {
      where: transactionPeriodFilter(from, to),
      select: {
        amountCents: true,
        occurredOn: true,
        isRecurring: true,
        recurrenceEndsOn: true,
        category: { select: { transactionType: true } },
      },
    },
  }) satisfies Prisma.PropertySelect;

type CashFlowRow = Prisma.PropertyGetPayload<{ select: ReturnType<typeof cashFlowSelect> }>;

function toCashFlowRecord(row: CashFlowRow): CashFlowPropertyRecord {
  return {
    id: row.id,
    usageType: row.usageType,
    rentalMode: row.rentalMode,
    ownershipPercentage: row.ownershipPercentage.toNumber(),
    annualExpensesCents: row.annualExpensesCents,
    occupancyRate: row.occupancyRate.toNumber(),
    manualMonthlyRentCents: row.manualRental?.monthlyRentCents ?? null,
    contracts: row.contracts.flatMap(({ rentTerms, ...contract }) =>
      rentTerms ? [{ ...contract, monthlyRentCents: rentTerms.monthlyRentCents }] : [],
    ),
    reservations: row.reservations,
    transactions: row.transactions.map(({ category, ...transaction }) => ({
      ...transaction,
      transactionType: category.transactionType,
    })),
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createKpisRepository(prisma: PrismaClient): KpisRepository {
  return {
    async loadProperties(scope, { propertyId, clientId, reservationsFrom, reservationsTo }) {
      const rows = await prisma.property.findMany({
        where: {
          organizationId: scope.organizationId,
          ...(scope.createdById ? { createdById: scope.createdById } : {}),
          ...(propertyId ? { id: propertyId } : {}),
          ...(clientId ? { clientId } : {}),
        },
        select,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      if (rows.length === 0) return [];

      const booked = await prisma.reservation.groupBy({
        by: ["propertyId"],
        where: {
          propertyId: { in: rows.map((row) => row.id) },
          status: "confirmed",
          checkIn: { gte: reservationsFrom, lte: reservationsTo },
        },
        _sum: { totalAmountCents: true },
      });
      const totals = new Map(booked.map((entry) => [entry.propertyId, entry._sum.totalAmountCents ?? 0n]));

      return rows.map((row) => toRecord(row, totals.get(row.id) ?? 0n));
    },

    async loadCashFlow(scope, { propertyId, from, to }) {
      const rows = await prisma.property.findMany({
        where: {
          organizationId: scope.organizationId,
          ...(scope.createdById ? { createdById: scope.createdById } : {}),
          ...(propertyId ? { id: propertyId } : {}),
        },
        select: cashFlowSelect({ from, to }),
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map(toCashFlowRecord);
    },
  };
}
