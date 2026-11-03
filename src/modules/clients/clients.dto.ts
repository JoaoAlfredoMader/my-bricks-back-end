import type { PersonType } from "../../generated/prisma/enums.js";
import type { ClientRecord } from "./clients.repository.js";

/** Shape returned by the API. Dates are ISO strings. */
export interface ClientDto {
  id: string;
  name: string;
  personType: PersonType;
  document: string | null;
  email: string | null;
  whatsapp: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export function toClientDto(record: ClientRecord): ClientDto {
  return {
    id: record.id,
    name: record.name,
    personType: record.personType,
    document: record.document,
    email: record.email,
    whatsapp: record.whatsapp,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
