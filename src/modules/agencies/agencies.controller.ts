import type { TenantScope } from "../../shared/http/tenant.js";
import type { AgenciesService, AgencyDto, Page } from "./agencies.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface AgenciesController {
  list(
    tenant: TenantScope,
    query: { page: number; pageSize: number; search?: string | undefined },
  ): Promise<HttpResult<Page<AgencyDto>>>;
  get(tenant: TenantScope, id: string): Promise<HttpResult<AgencyDto>>;
  create(tenant: TenantScope, input: { name: string }): Promise<HttpResult<AgencyDto, 201>>;
  update(tenant: TenantScope, id: string, input: { name: string }): Promise<HttpResult<AgencyDto>>;
  remove(tenant: TenantScope, id: string): Promise<HttpResult<null, 204>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createAgenciesController(service: AgenciesService): AgenciesController {
  return {
    async list(tenant, query) {
      return { status: 200, body: await service.list(tenant, query) };
    },
    async get(tenant, id) {
      return { status: 200, body: await service.get(tenant, id) };
    },
    async create(tenant, input) {
      return { status: 201, body: await service.create(tenant, input) };
    },
    async update(tenant, id, input) {
      return { status: 200, body: await service.update(tenant, id, input) };
    },
    async remove(tenant, id) {
      await service.remove(tenant, id);
      return { status: 204, body: null };
    },
  };
}
