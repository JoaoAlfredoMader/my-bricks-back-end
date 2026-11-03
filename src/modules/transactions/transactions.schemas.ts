import { z } from "zod";
import { TransactionType } from "../../generated/prisma/enums.js";
import { optionalText } from "../../shared/validation/optional-text.js";

/** Calendar date as `YYYY-MM-DD`. ISO dates compare correctly as plain strings. */
const date = z.iso.date();

/** Always positive: the category says whether it is revenue or expense. */
const amountCents = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const createTransactionSchema = z
  .object({
    propertyId: z.uuid(),
    categoryId: z.number().int().positive(),
    amountCents,
    occurredOn: date,
    description: optionalText(z.string().trim().max(500)),
    /** Repeats every month from `occurredOn` until `recurrenceEndsOn`. */
    isRecurring: z.boolean().default(false),
    /** `null` = still running. Only for recurring transactions. */
    recurrenceEndsOn: date.nullish(),
  })
  .superRefine((input, context) => {
    if (input.recurrenceEndsOn && !input.isRecurring) {
      context.addIssue({ code: "custom", path: ["recurrenceEndsOn"], message: "Only recurring transactions have an end date" });
    }
    if (input.recurrenceEndsOn && input.recurrenceEndsOn < input.occurredOn) {
      context.addIssue({ code: "custom", path: ["recurrenceEndsOn"], message: "The end date cannot be before the first occurrence" });
    }
  });

/** The property is fixed; everything else can change. */
export const updateTransactionSchema = z
  .object({
    categoryId: z.number().int().positive(),
    amountCents,
    occurredOn: date,
    description: optionalText(z.string().trim().max(500)),
    isRecurring: z.boolean(),
    recurrenceEndsOn: date.nullable(),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  propertyId: z.uuid().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  /** Revenue or expense, taken from the category. */
  type: z.enum(TransactionType).optional(),
  isRecurring: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  from: date.optional(),
  to: date.optional(),
});

export const transactionIdParamSchema = z.object({ id: z.uuid() });

export type CreateTransactionInput = z.output<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.output<typeof updateTransactionSchema>;
export type ListTransactionsInput = z.output<typeof listTransactionsQuerySchema>;
