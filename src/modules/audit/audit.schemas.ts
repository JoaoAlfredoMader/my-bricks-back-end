import { z } from "zod";
import { AuditAction, AuditEntityType } from "../../generated/prisma/enums.js";

const filters = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.enum(AuditAction).optional(),
  entityType: z.enum(AuditEntityType).optional(),
  actorUserId: z.uuid().optional(),
  /** Calendar days (`YYYY-MM-DD`), both inclusive. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};

export const listAuditLogsQuerySchema = z.object(filters);

/** The platform operator can also narrow the trail to one organization. */
export const listAdminAuditLogsQuerySchema = z.object({ ...filters, organizationId: z.uuid().optional() });

export type ListAuditLogsInput = z.output<typeof listAdminAuditLogsQuerySchema>;
