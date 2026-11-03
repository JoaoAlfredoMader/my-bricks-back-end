import type { TenantScope } from "../../shared/http/tenant.js";
import type { ContractCreatedDto, ContractDto, Page } from "./contracts.dto.js";
import type {
  CreateContractInput,
  EndContractInput,
  ListContractsInput,
  UpdateContractInput,
} from "./contracts.schemas.js";
import type { ContractsService } from "./contracts.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface ContractsController {
  list(tenant: TenantScope, query: ListContractsInput): Promise<HttpResult<Page<ContractDto>>>;
  get(tenant: TenantScope, id: string): Promise<HttpResult<ContractDto>>;
  create(tenant: TenantScope, input: CreateContractInput): Promise<HttpResult<ContractCreatedDto, 201>>;
  update(tenant: TenantScope, id: string, input: UpdateContractInput): Promise<HttpResult<ContractDto>>;
  end(tenant: TenantScope, id: string, input: EndContractInput): Promise<HttpResult<ContractDto>>;
  cancel(tenant: TenantScope, id: string): Promise<HttpResult<ContractDto>>;
}

/**
 * Controller layer: receives already-validated input (never the Hono Context),
 * calls the service and maps the result to a status code and DTO.
 */
export function createContractsController(service: ContractsService): ContractsController {
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
    async end(tenant, id, input) {
      return { status: 200, body: await service.end(tenant, id, input) };
    },
    async cancel(tenant, id) {
      return { status: 200, body: await service.cancel(tenant, id) };
    },
  };
}
