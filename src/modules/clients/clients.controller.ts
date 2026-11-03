import type { TenantScope } from "../../shared/http/tenant.js";
import type { ClientDto, Page } from "./clients.dto.js";
import type { CreateClientInput, ListClientsInput, UpdateClientInput } from "./clients.schemas.js";
import type { ClientsService } from "./clients.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface ClientsController {
  list(tenant: TenantScope, query: ListClientsInput): Promise<HttpResult<Page<ClientDto>>>;
  get(tenant: TenantScope, id: string): Promise<HttpResult<ClientDto>>;
  create(tenant: TenantScope, input: CreateClientInput): Promise<HttpResult<ClientDto, 201>>;
  update(tenant: TenantScope, id: string, input: UpdateClientInput): Promise<HttpResult<ClientDto>>;
  remove(tenant: TenantScope, id: string): Promise<HttpResult<null, 204>>;
}

/**
 * Controller layer: receives already-validated input (never the Hono Context),
 * calls the service and maps the result to a status code and DTO.
 */
export function createClientsController(service: ClientsService): ClientsController {
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
