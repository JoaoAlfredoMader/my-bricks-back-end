import type { FeedbackStatus } from "../../generated/prisma/enums.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import type { AdminFeedbackDto, FeedbackDto, Page } from "./feedback.dto.js";
import type { CreateFeedbackInput, ListFeedbackInput } from "./feedback.schemas.js";
import type { FeedbackService } from "./feedback.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface FeedbackController {
  send(tenant: TenantScope, input: CreateFeedbackInput): Promise<HttpResult<FeedbackDto, 201>>;
  listMine(tenant: TenantScope, query: ListFeedbackInput): Promise<HttpResult<Page<FeedbackDto>>>;
  listAll(query: ListFeedbackInput): Promise<HttpResult<Page<AdminFeedbackDto>>>;
  setStatus(id: string, status: FeedbackStatus): Promise<HttpResult<AdminFeedbackDto>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createFeedbackController(service: FeedbackService): FeedbackController {
  return {
    async send(tenant, input) {
      return { status: 201, body: await service.send(tenant, input) };
    },
    async listMine(tenant, query) {
      return { status: 200, body: await service.listMine(tenant, query) };
    },
    async listAll(query) {
      return { status: 200, body: await service.listAll(query) };
    },
    async setStatus(id, status) {
      return { status: 200, body: await service.setStatus(id, status) };
    },
  };
}
