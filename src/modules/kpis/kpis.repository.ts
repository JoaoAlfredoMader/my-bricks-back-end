import type { Prisma } from "../../generated/prisma/client.js";
import type { ContractType, RentalMode, TransactionType, UsageType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

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

export interface KpisRepository {
  loadProperties(scope: KpiScope, query: KpiQuery): Promise<PropertyKpiRecord[]>;
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
  };
}
