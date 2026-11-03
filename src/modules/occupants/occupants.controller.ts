import type { TenantScope } from "../../shared/http/tenant.js";
import type { OccupantDto, OccupantsService, Page } from "./occupants.service.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface OccupantsController {
  list(
    tenant: TenantScope,
    query: { page: number; pageSize: number; search?: string },
  ): Promise<HttpResult<Page<OccupantDto>>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createOccupantsController(service: OccupantsService): OccupantsController {
  return {
    async list(tenant, query) {
      return { status: 200, body: await service.list(tenant, query) };
    },
  };
}
