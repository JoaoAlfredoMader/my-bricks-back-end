import type { TenantScope } from "../../shared/http/tenant.js";
import type { ContractTemplatesService, TemplateDto } from "./contract-templates.service.js";
import type { UpdateTemplateInput } from "./contract-templates.schemas.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface ContractTemplatesController {
  get(tenant: TenantScope): Promise<HttpResult<TemplateDto>>;
  update(tenant: TenantScope, input: UpdateTemplateInput): Promise<HttpResult<TemplateDto>>;
  reset(tenant: TenantScope): Promise<HttpResult<TemplateDto>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createContractTemplatesController(service: ContractTemplatesService): ContractTemplatesController {
  return {
    async get(tenant) {
      return { status: 200, body: await service.get(tenant) };
    },
    async update(tenant, input) {
      return { status: 200, body: await service.update(tenant, input) };
    },
    async reset(tenant) {
      return { status: 200, body: await service.reset(tenant) };
    },
  };
}
