import type { ProposalType } from "../../generated/prisma/enums.js";
import { centsToNumber } from "../../shared/money.js";
import type { ProposalRecord } from "./proposals.repository.js";

/** Shape returned by the API. Money is integer cents, calendar dates are `YYYY-MM-DD`. */
export interface ProposalDto {
  id: string;
  propertyId: string;
  proposalType: ProposalType;
  amountCents: number;
  proposalDate: string;
  contact: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export function toProposalDto(record: ProposalRecord): ProposalDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    proposalType: record.proposalType,
    amountCents: centsToNumber(record.amountCents),
    proposalDate: record.proposalDate.toISOString().slice(0, 10),
    contact: record.contact,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
  };
}
