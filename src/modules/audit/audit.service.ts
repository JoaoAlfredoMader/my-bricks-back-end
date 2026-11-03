import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { type AuditLogDto, type Page, toAuditLogDto } from "./audit.dto.js";
import type { AuditFilter, AuditRepository } from "./audit.repository.js";
import type { ListAuditLogsInput } from "./audit.schemas.js";

export interface AuditService {
  /** The trail of the caller's organization. Only owners and admins may read it. */
  listForOrganization(tenant: TenantScope, query: ListAuditLogsInput): Promise<Page<AuditLogDto>>;
  /** The whole trail, for the platform operator. */
  listAll(query: ListAuditLogsInput): Promise<Page<AuditLogDto>>;
}

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nextDay = (value: string) => new Date(toDate(value).getTime() + 86_400_000);

function toFilter(query: ListAuditLogsInput): AuditFilter {
  return {
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from ? { from: toDate(query.from) } : {}),
    // `to` is a calendar day and inclusive, so the bound is the start of the next day.
    ...(query.to ? { to: nextDay(query.to) } : {}),
  };
}

/** Service layer: who may read the trail. No HTTP, no Prisma. */
export function createAuditService(repository: AuditRepository): AuditService {
  async function page(filter: AuditFilter, { page, pageSize }: ListAuditLogsInput): Promise<Page<AuditLogDto>> {
    const { items, total } = await repository.list(filter, { skip: (page - 1) * pageSize, take: pageSize });
    return { items: items.map(toAuditLogDto), page, pageSize, total };
  }

  return {
    listForOrganization(tenant, query) {
      if (!tenant.canSeeAll) throw AppError.forbidden("Only owners and admins can read the audit log");
      // The organization always comes from the session; the query cannot widen it.
      return page({ ...toFilter(query), organizationId: tenant.organizationId }, query);
    },

    listAll(query) {
      return page({ ...toFilter(query), ...(query.organizationId ? { organizationId: query.organizationId } : {}) }, query);
    },
  };
}
