import type { TransactionType } from "../../generated/prisma/enums.js";
import { centsToNumber } from "../../shared/money.js";
import type { TransactionRecord } from "./transactions.repository.js";

/** Shape returned by the API. Money is integer cents, calendar dates are `YYYY-MM-DD`. */
export interface TransactionDto {
  id: string;
  propertyId: string;
  propertyName: string;
  categoryId: number;
  categoryName: string;
  /** Derived from the category, never stored on the transaction. */
  type: TransactionType;
  /** Always positive; `type` tells revenue from expense. */
  amountCents: number;
  occurredOn: string;
  description: string | null;
  isRecurring: boolean;
  recurrenceEndsOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

export function toTransactionDto(record: TransactionRecord): TransactionDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    propertyName: record.property.name,
    categoryId: record.categoryId,
    categoryName: record.category.name,
    type: record.category.transactionType,
    amountCents: centsToNumber(record.amountCents),
    occurredOn: toDateOnly(record.occurredOn),
    description: record.description,
    isRecurring: record.isRecurring,
    recurrenceEndsOn: record.recurrenceEndsOn ? toDateOnly(record.recurrenceEndsOn) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
