import { z } from "zod";
import { AdjustmentIndex, ContractStatus, ContractType } from "../../generated/prisma/enums.js";
import { optionalText } from "../../shared/validation/optional-text.js";
import { occupantInputSchema } from "../occupants/occupant-input.js";

/** Calendar date as `YYYY-MM-DD`. ISO dates compare correctly as plain strings. */
const date = z.iso.date();
const positiveCents = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const rentTermsFields = {
  monthlyRentCents: positiveCents,
  dueDay: z.number().int().min(1).max(31),
  adjustmentIndex: z.enum(AdjustmentIndex).nullish(),
};

export const createContractSchema = z
  .object({
    propertyId: z.uuid(),
    contractType: z.enum(ContractType),
    startDate: date,
    endDate: date.nullish(),
    notes: optionalText(z.string().trim().max(10_000)),
    /** Reuse an existing occupant... */
    occupantId: z.uuid().optional(),
    /** ...or describe a new one (an existing occupant with the same document is reused). */
    occupant: occupantInputSchema.optional(),
    /** Required for conventional contracts, not allowed for short-stay ones. */
    rentTerms: z.object(rentTermsFields).nullish(),
  })
  .superRefine((input, context) => {
    if ((input.occupantId === undefined) === (input.occupant === undefined)) {
      context.addIssue({ code: "custom", path: ["occupantId"], message: "Send either occupantId or occupant" });
    }
    if (input.endDate && input.endDate <= input.startDate) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
    }
    if (input.contractType === "conventional" && !input.rentTerms) {
      context.addIssue({ code: "custom", path: ["rentTerms"], message: "Conventional contracts need rent terms" });
    }
    if (input.contractType === "short_stay" && input.rentTerms) {
      context.addIssue({ code: "custom", path: ["rentTerms"], message: "Short-stay contracts have no rent terms" });
    }
  });

/** Only active contracts can be edited; the type, property and occupant are fixed. */
export const updateContractSchema = z
  .object({
    endDate: date.nullable(),
    notes: optionalText(z.string().trim().max(10_000)),
    rentTerms: z
      .object({
        monthlyRentCents: rentTermsFields.monthlyRentCents,
        dueDay: rentTermsFields.dueDay,
        adjustmentIndex: rentTermsFields.adjustmentIndex,
      })
      .partial(),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const endContractSchema = z.object({ endDate: date.optional() });

export const listContractsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  propertyId: z.uuid().optional(),
  status: z.enum(ContractStatus).optional(),
  contractType: z.enum(ContractType).optional(),
});

export const contractIdParamSchema = z.object({ id: z.uuid() });

export type CreateContractInput = z.output<typeof createContractSchema>;
export type UpdateContractInput = z.output<typeof updateContractSchema>;
export type EndContractInput = z.output<typeof endContractSchema>;
export type ListContractsInput = z.output<typeof listContractsQuerySchema>;
