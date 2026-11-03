import { z } from "zod";
import { ProposalType } from "../../generated/prisma/enums.js";
import { optionalText } from "../../shared/validation/optional-text.js";

const date = z.iso.date();
const amountCents = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const createProposalSchema = z.object({
  proposalType: z.enum(ProposalType),
  amountCents,
  proposalDate: date,
  /** Who made the proposal. */
  contact: optionalText(z.string().trim().max(255)),
  notes: optionalText(z.string().trim().max(10_000)),
});

export const updateProposalSchema = z
  .object({
    proposalType: z.enum(ProposalType),
    amountCents,
    proposalDate: date,
    contact: optionalText(z.string().trim().max(255)),
    notes: optionalText(z.string().trim().max(10_000)),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const listProposalsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  proposalType: z.enum(ProposalType).optional(),
});

export const proposalParamsSchema = z.object({ propertyId: z.uuid(), id: z.uuid() });
export const propertyParamSchema = z.object({ propertyId: z.uuid() });

export type CreateProposalInput = z.output<typeof createProposalSchema>;
export type UpdateProposalInput = z.output<typeof updateProposalSchema>;
export type ListProposalsInput = z.output<typeof listProposalsQuerySchema>;
