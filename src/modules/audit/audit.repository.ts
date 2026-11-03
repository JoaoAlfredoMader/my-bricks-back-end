import type { Prisma } from "../../generated/prisma/client.js";
import type { AuditAction, AuditEntityType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  organizationId: true,
  actorUserId: true,
  actorName: true,
  actorEmail: true,
  actorRole: true,
  impersonatedById: true,
  action: true,
  entityType: true,
  entityId: true,
  details: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export type AuditRecord = Prisma.AuditLogGetPayload<{ select: typeof select }>;

/** One entry of the trail. The actor is a snapshot: it stays readable after the user is gone. */
export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  impersonatedById: string | null;
  action: AuditAction;
  entityType: AuditEntityType | null;
  entityId: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditFilter {
  /** `undefined` = every organization (platform operator). */
  organizationId?: string;
  action?: AuditAction;
  entityType?: AuditEntityType;
  actorUserId?: string;
  /** Inclusive lower bound and exclusive upper bound on `createdAt`. */
  from?: Date;
  to?: Date;
}

export interface AuditRepository {
  create(entry: AuditEntry): Promise<void>;
  list(filter: AuditFilter, page: { skip: number; take: number }): Promise<{ items: AuditRecord[]; total: number }>;
  /** Retention: removes everything older than the date. Returns how many entries were removed. */
  deleteOlderThan(date: Date): Promise<number>;
}

/** Repository layer: the only place that talks to Prisma. */
export function createAuditRepository(prisma: PrismaClient): AuditRepository {
  return {
    async create(entry) {
      await prisma.auditLog.create({ data: entry });
    },

    async list(filter, { skip, take }) {
      const where: Prisma.AuditLogWhereInput = {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        ...(filter.from || filter.to
          ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }),
        prisma.auditLog.count({ where }),
      ]);
      return { items, total };
    },

    async deleteOlderThan(date) {
      const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: date } } });
      return count;
    },
  };
}
