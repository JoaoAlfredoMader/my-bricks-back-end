import type { AuditAction, AuditEntityType } from "../../generated/prisma/enums.js";
import type { AuditRecord } from "./audit.repository.js";

/** Shape returned by the API. The numeric id travels as a string (JSON has no 64-bit integers). */
export interface AuditLogDto {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  /** Set when a platform admin acted through impersonation. */
  impersonatedById: string | null;
  action: AuditAction;
  entityType: AuditEntityType | null;
  entityId: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export function toAuditLogDto(record: AuditRecord): AuditLogDto {
  return { ...record, id: record.id.toString(), createdAt: record.createdAt.toISOString() };
}
