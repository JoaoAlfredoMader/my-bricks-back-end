import type { TenantScope } from "../../shared/http/tenant.js";
import type { Page, TransactionDto } from "./transactions.dto.js";
import type {
  CreateTransactionInput,
  ListTransactionsInput,
  UpdateTransactionInput,
} from "./transactions.schemas.js";
import type { TransactionsService } from "./transactions.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface TransactionsController {
  list(tenant: TenantScope, query: ListTransactionsInput): Promise<HttpResult<Page<TransactionDto>>>;
  get(tenant: TenantScope, id: string): Promise<HttpResult<TransactionDto>>;
  create(tenant: TenantScope, input: CreateTransactionInput): Promise<HttpResult<TransactionDto, 201>>;
  update(tenant: TenantScope, id: string, input: UpdateTransactionInput): Promise<HttpResult<TransactionDto>>;
  remove(tenant: TenantScope, id: string): Promise<HttpResult<null, 204>>;
}

/**
 * Controller layer: receives already-validated input (never the Hono Context),
 * calls the service and maps the result to a status code and DTO.
 */
export function createTransactionsController(service: TransactionsService): TransactionsController {
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
