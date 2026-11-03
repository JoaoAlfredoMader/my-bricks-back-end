import type { TenantScope } from "../../shared/http/tenant.js";
import type { Page, ProposalDto } from "./proposals.dto.js";
import type { CreateProposalInput, ListProposalsInput, UpdateProposalInput } from "./proposals.schemas.js";
import type { ProposalsService } from "./proposals.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface ProposalsController {
  list(tenant: TenantScope, propertyId: string, query: ListProposalsInput): Promise<HttpResult<Page<ProposalDto>>>;
  get(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<ProposalDto>>;
  create(tenant: TenantScope, propertyId: string, input: CreateProposalInput): Promise<HttpResult<ProposalDto, 201>>;
  update(tenant: TenantScope, propertyId: string, id: string, input: UpdateProposalInput): Promise<HttpResult<ProposalDto>>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<null, 204>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createProposalsController(service: ProposalsService): ProposalsController {
  return {
    async list(tenant, propertyId, query) {
      return { status: 200, body: await service.list(tenant, propertyId, query) };
    },
    async get(tenant, propertyId, id) {
      return { status: 200, body: await service.get(tenant, propertyId, id) };
    },
    async create(tenant, propertyId, input) {
      return { status: 201, body: await service.create(tenant, propertyId, input) };
    },
    async update(tenant, propertyId, id, input) {
      return { status: 200, body: await service.update(tenant, propertyId, id, input) };
    },
    async remove(tenant, propertyId, id) {
      await service.remove(tenant, propertyId, id);
      return { status: 204, body: null };
    },
  };
}
