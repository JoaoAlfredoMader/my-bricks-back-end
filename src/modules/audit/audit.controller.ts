import type { TenantScope } from "../../shared/http/tenant.js";
import type { AuditLogDto, Page } from "./audit.dto.js";
import type { ListAuditLogsInput } from "./audit.schemas.js";
import type { AuditService } from "./audit.service.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface AuditController {
  listForOrganization(tenant: TenantScope, query: ListAuditLogsInput): Promise<HttpResult<Page<AuditLogDto>>>;
  listAll(query: ListAuditLogsInput): Promise<HttpResult<Page<AuditLogDto>>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createAuditController(service: AuditService): AuditController {
  return {
    async listForOrganization(tenant, query) {
      return { status: 200, body: await service.listForOrganization(tenant, query) };
    },
    async listAll(query) {
      return { status: 200, body: await service.listAll(query) };
    },
  };
}
