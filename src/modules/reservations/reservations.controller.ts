import type { TenantScope } from "../../shared/http/tenant.js";
import type { Page, ReservationDto } from "./reservations.dto.js";
import type {
  CreateReservationInput,
  ListReservationsInput,
  UpdateReservationInput,
} from "./reservations.schemas.js";
import type { ReservationsService } from "./reservations.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface ReservationsController {
  list(tenant: TenantScope, query: ListReservationsInput): Promise<HttpResult<Page<ReservationDto>>>;
  get(tenant: TenantScope, id: string): Promise<HttpResult<ReservationDto>>;
  create(tenant: TenantScope, input: CreateReservationInput): Promise<HttpResult<ReservationDto, 201>>;
  update(tenant: TenantScope, id: string, input: UpdateReservationInput): Promise<HttpResult<ReservationDto>>;
  cancel(tenant: TenantScope, id: string): Promise<HttpResult<ReservationDto>>;
}

/**
 * Controller layer: receives already-validated input (never the Hono Context),
 * calls the service and maps the result to a status code and DTO.
 */
export function createReservationsController(service: ReservationsService): ReservationsController {
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
    async cancel(tenant, id) {
      return { status: 200, body: await service.cancel(tenant, id) };
    },
  };
}
