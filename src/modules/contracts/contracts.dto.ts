import type { AdjustmentIndex, ContractStatus, ContractType } from "../../generated/prisma/enums.js";
import { centsToNumber } from "../../shared/money.js";
import type { ContractRecord } from "./contracts.repository.js";

/** Shape returned by the API. Money is integer cents, calendar dates are `YYYY-MM-DD`. */
export interface ContractDto {
  id: string;
  propertyId: string;
  propertyName: string;
  contractType: ContractType;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  occupant: { id: string; name: string; document: string | null; email: string | null; phone: string | null };
  /** Conventional contracts only. */
  rentTerms: { monthlyRentCents: number; dueDay: number; adjustmentIndex: AdjustmentIndex | null } | null;
  /** Path of the generated PDF, once there is one (see `POST /api/contracts/:id/pdf`). */
  pdfUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractCreatedDto extends ContractDto {
  /** Id of the active contract that this one replaced, if the property had one. */
  replacedContractId: string | null;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

export function toContractDto(record: ContractRecord): ContractDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    propertyName: record.property.name,
    contractType: record.contractType,
    status: record.status,
    startDate: toDateOnly(record.startDate),
    endDate: record.endDate ? toDateOnly(record.endDate) : null,
    notes: record.notes,
    occupant: record.occupant,
    rentTerms: record.rentTerms && {
      monthlyRentCents: centsToNumber(record.rentTerms.monthlyRentCents),
      dueDay: record.rentTerms.dueDay,
      adjustmentIndex: record.rentTerms.adjustmentIndex,
    },
    pdfUrl: record.pdfFileId ? `/api/contracts/${record.id}/pdf` : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
