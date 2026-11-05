import type { Prisma } from "../../generated/prisma/client.js";

const firstOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

/**
 * Period filter that knows about recurrence. A recurring transaction is one record that stands for
 * a charge every month from `occurredOn` until `recurrenceEndsOn`, so it belongs to the period when
 * it started on or before `to` and has not ended before `from`. The end is compared by month,
 * inclusive (an end date anywhere in the month of `from` still reaches it), the same way the IRR
 * cash flow and the monthly cash flow read it. A one-off transaction keeps the plain date rule.
 *
 * Both bounds are inclusive and optional; give at least one.
 */
export function transactionPeriodFilter(from: Date | undefined, to: Date | undefined): Prisma.TransactionWhereInput {
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
