import type { ReservationStatus } from "../../generated/prisma/enums.js";
import { centsToNumber } from "../../shared/money.js";
import type { ReservationRecord } from "./reservations.repository.js";

/** Shape returned by the API. Money is integer cents, calendar dates are `YYYY-MM-DD`. */
export interface ReservationDto {
  id: string;
  propertyId: string;
  propertyName: string;
  contractId: string | null;
  guest: { id: string; name: string; document: string | null; email: string | null; phone: string | null };
  checkIn: string;
  checkOut: string;
  /** Derived from the dates, never stored. */
  nights: number;
  totalAmountCents: number;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

const MS_PER_DAY = 86_400_000;
const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

export function toReservationDto(record: ReservationRecord): ReservationDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    propertyName: record.property.name,
    contractId: record.contractId,
    guest: record.occupant,
    checkIn: toDateOnly(record.checkIn),
    checkOut: toDateOnly(record.checkOut),
    nights: Math.round((record.checkOut.getTime() - record.checkIn.getTime()) / MS_PER_DAY),
    totalAmountCents: centsToNumber(record.totalAmountCents),
    status: record.status,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
