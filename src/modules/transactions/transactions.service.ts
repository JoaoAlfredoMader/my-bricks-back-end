import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { numberToCents } from "../../shared/money.js";
import { type Page, type TransactionDto, toTransactionDto } from "./transactions.dto.js";
import type {
  TransactionPatch,
  TransactionRecord,
  TransactionScope,
  TransactionsRepository,
} from "./transactions.repository.js";
import type {
  CreateTransactionInput,
  ListTransactionsInput,
  UpdateTransactionInput,
} from "./transactions.schemas.js";

export interface TransactionsService {
  list(tenant: TenantScope, query: ListTransactionsInput): Promise<Page<TransactionDto>>;
  get(tenant: TenantScope, id: string): Promise<TransactionDto>;
  create(tenant: TenantScope, input: CreateTransactionInput): Promise<TransactionDto>;
  update(tenant: TenantScope, id: string, input: UpdateTransactionInput): Promise<TransactionDto>;
  remove(tenant: TenantScope, id: string): Promise<void>;
}

/** Owners and admins see the whole organization; members only transactions of properties they created. */
function visibleScope(tenant: TenantScope): TransactionScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** Service layer: business rules. No HTTP, no Prisma. */
export function createTransactionsService(repository: TransactionsRepository): TransactionsService {
  async function loadOrFail(scope: TransactionScope, id: string): Promise<TransactionRecord> {
    const transaction = await repository.findById(scope, id);
    if (!transaction) throw AppError.notFound("Transaction not found");
    return transaction;
  }

  async function assertCategoryExists(categoryId: number): Promise<void> {
    if (!(await repository.categoryExists(categoryId))) {
      throw AppError.validation([{ path: "categoryId", message: "Category not found" }]);
    }
  }

  return {
    async list(tenant, { page, pageSize, propertyId, categoryId, type, isRecurring, from, to }) {
      const { items, total } = await repository.list(visibleScope(tenant), {
        ...(propertyId ? { propertyId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(type ? { transactionType: type } : {}),
        ...(isRecurring !== undefined ? { isRecurring } : {}),
        ...(from ? { from: toDate(from) } : {}),
        ...(to ? { to: toDate(to) } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toTransactionDto), page, pageSize, total };
    },

    async get(tenant, id) {
      return toTransactionDto(await loadOrFail(visibleScope(tenant), id));
    },

    async create(tenant, input) {
      const scope = visibleScope(tenant);
      if (!(await repository.propertyVisible(scope, input.propertyId))) throw AppError.notFound("Property not found");
      await assertCategoryExists(input.categoryId);

      const created = await repository.create(scope, {
        propertyId: input.propertyId,
        categoryId: input.categoryId,
        amountCents: numberToCents(input.amountCents),
        occurredOn: toDate(input.occurredOn),
        description: input.description ?? null,
        isRecurring: input.isRecurring,
        recurrenceEndsOn: input.recurrenceEndsOn ? toDate(input.recurrenceEndsOn) : null,
      });
      return toTransactionDto(created);
    },

    async update(tenant, id, input) {
      const scope = visibleScope(tenant);
      const current = await loadOrFail(scope, id);
      if (input.categoryId !== undefined) await assertCategoryExists(input.categoryId);

      // The recurrence fields must stay consistent after the change, even when only some are sent.
      const occurredOn = input.occurredOn ?? toDateOnly(current.occurredOn);
      const isRecurring = input.isRecurring ?? current.isRecurring;
      const currentEnd = current.recurrenceEndsOn ? toDateOnly(current.recurrenceEndsOn) : null;
      const explicitEnd = input.recurrenceEndsOn;
      // Turning recurrence off drops the end date on its own; sending one at the same time is a mistake.
      const recurrenceEndsOn = explicitEnd !== undefined ? explicitEnd : isRecurring ? currentEnd : null;

      if (recurrenceEndsOn !== null && !isRecurring) {
        throw AppError.validation([{ path: "recurrenceEndsOn", message: "Only recurring transactions have an end date" }]);
      }
      if (recurrenceEndsOn !== null && recurrenceEndsOn < occurredOn) {
        throw AppError.validation([{ path: "recurrenceEndsOn", message: "The end date cannot be before the first occurrence" }]);
      }

      const patch: TransactionPatch = {};
      if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
      if (input.amountCents !== undefined) patch.amountCents = numberToCents(input.amountCents);
      if (input.occurredOn !== undefined) patch.occurredOn = toDate(input.occurredOn);
      if (input.description !== undefined) patch.description = input.description;
      if (input.isRecurring !== undefined) patch.isRecurring = input.isRecurring;
      if (explicitEnd !== undefined || recurrenceEndsOn !== currentEnd) {
        patch.recurrenceEndsOn = recurrenceEndsOn ? toDate(recurrenceEndsOn) : null;
      }

      const updated = await repository.update(scope, id, patch);
      if (!updated) throw AppError.notFound("Transaction not found");
      return toTransactionDto(updated);
    },

    async remove(tenant, id) {
      if (!(await repository.delete(visibleScope(tenant), id))) throw AppError.notFound("Transaction not found");
    },
  };
}
