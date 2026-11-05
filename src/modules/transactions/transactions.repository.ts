import type { Prisma } from "../../generated/prisma/client.js";
import type { TransactionType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  propertyId: true,
  categoryId: true,
  amountCents: true,
  occurredOn: true,
  description: true,
  isRecurring: true,
  recurrenceEndsOn: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { name: true } },
  category: { select: { name: true, transactionType: true } },
} satisfies Prisma.TransactionSelect;

export type TransactionRecord = Prisma.TransactionGetPayload<{ select: typeof select }>;

/** Every query is bound to one organization; members only reach transactions of properties they created. */
export interface TransactionScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface NewTransactionData {
  propertyId: string;
  categoryId: number;
  amountCents: bigint;
  occurredOn: Date;
  description: string | null;
  isRecurring: boolean;
  recurrenceEndsOn: Date | null;
}

export type TransactionPatch = Partial<Omit<NewTransactionData, "propertyId">>;

export interface TransactionListQuery {
  propertyId?: string;
  categoryId?: number;
  transactionType?: TransactionType;
  isRecurring?: boolean;
  /**
   * Inclusive period. A one-off transaction is kept when `occurredOn` is inside it; a recurring one
   * when its run of monthly occurrences touches it (see `periodFilter`).
   */
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface TransactionsRepository {
  list(scope: TransactionScope, query: TransactionListQuery): Promise<{ items: TransactionRecord[]; total: number }>;
  findById(scope: TransactionScope, id: string): Promise<TransactionRecord | null>;
  create(scope: TransactionScope, data: NewTransactionData): Promise<TransactionRecord>;
  update(scope: TransactionScope, id: string, patch: TransactionPatch): Promise<TransactionRecord | null>;
  delete(scope: TransactionScope, id: string): Promise<boolean>;

  propertyVisible(scope: TransactionScope, propertyId: string): Promise<boolean>;
  categoryExists(categoryId: number): Promise<boolean>;
}

function whereFor(scope: TransactionScope): Prisma.TransactionWhereInput {
  return {
    organizationId: scope.organizationId,
    ...(scope.propertyCreatedById ? { property: { createdById: scope.propertyCreatedById } } : {}),
  };
}

const firstOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

/**
 * Period filter that knows about recurrence. A recurring transaction is one record that stands for
 * a charge every month from `occurredOn` until `recurrenceEndsOn`, so it belongs to the period when
 * it started on or before `to` and has not ended before `from`. The end is compared by month,
 * inclusive (an end date anywhere in the month of `from` still reaches it), the same way the IRR
 * cash flow reads it.
 */
function periodFilter(from: Date | undefined, to: Date | undefined): Prisma.TransactionWhereInput {
  const oneOff: Prisma.TransactionWhereInput = {
    isRecurring: false,
    occurredOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
  };
  const recurring: Prisma.TransactionWhereInput = {
    isRecurring: true,
    ...(to ? { occurredOn: { lte: to } } : {}),
    ...(from ? { OR: [{ recurrenceEndsOn: null }, { recurrenceEndsOn: { gte: firstOfMonth(from) } }] } : {}),
  };
  return { OR: [oneOff, recurring] };
}

/** Repository layer: the only place that talks to Prisma. */
export function createTransactionsRepository(prisma: PrismaClient): TransactionsRepository {
  return {
    async list(scope, { propertyId, categoryId, transactionType, isRecurring, from, to, skip, take }) {
      const where: Prisma.TransactionWhereInput = {
        ...whereFor(scope),
        ...(propertyId ? { propertyId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(transactionType ? { category: { transactionType } } : {}),
        ...(isRecurring !== undefined ? { isRecurring } : {}),
        ...(from || to ? { AND: [periodFilter(from, to)] } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          select,
          orderBy: [{ occurredOn: "desc" }, { id: "asc" }],
          skip,
          take,
        }),
        prisma.transaction.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, id) {
      return prisma.transaction.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    create(scope, data) {
      return prisma.transaction.create({
        data: { ...data, organizationId: scope.organizationId },
        select,
      });
    },

    async update(scope, id, patch) {
      const { count } = await prisma.transaction.updateMany({ where: { ...whereFor(scope), id }, data: patch });
      if (count === 0) return null;
      return prisma.transaction.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    async delete(scope, id) {
      const { count } = await prisma.transaction.deleteMany({ where: { ...whereFor(scope), id } });
      return count > 0;
    },

    async propertyVisible(scope, propertyId) {
      const count = await prisma.property.count({
        where: {
          id: propertyId,
          organizationId: scope.organizationId,
          ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
        },
      });
      return count > 0;
    },

    async categoryExists(categoryId) {
      return (await prisma.transactionCategory.count({ where: { id: categoryId } })) > 0;
    },
  };
}
