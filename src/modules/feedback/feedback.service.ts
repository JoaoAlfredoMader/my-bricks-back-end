import type { FeedbackStatus } from "../../generated/prisma/enums.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import {
  type AdminFeedbackDto,
  type FeedbackDto,
  type Page,
  toAdminFeedbackDto,
  toFeedbackDto,
} from "./feedback.dto.js";
import type { FeedbackRepository } from "./feedback.repository.js";
import type { CreateFeedbackInput, ListFeedbackInput } from "./feedback.schemas.js";

export interface FeedbackService {
  /** Any signed-in user can send feedback from the organization they are working in. */
  send(tenant: TenantScope, input: CreateFeedbackInput): Promise<FeedbackDto>;
  listMine(tenant: TenantScope, query: ListFeedbackInput): Promise<Page<FeedbackDto>>;
  /** Platform operator: every feedback of every organization. */
  listAll(query: ListFeedbackInput): Promise<Page<AdminFeedbackDto>>;
  setStatus(id: string, status: FeedbackStatus): Promise<AdminFeedbackDto>;
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createFeedbackService(repository: FeedbackRepository): FeedbackService {
  const toQuery = ({ page, pageSize, status }: ListFeedbackInput) => ({
    ...(status ? { status } : {}),
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    async send(tenant, { message }) {
      return toFeedbackDto(
        await repository.create({ organizationId: tenant.organizationId, userId: tenant.userId, message }),
      );
    },

    async listMine(tenant, query) {
      const { items, total } = await repository.list({ userId: tenant.userId }, toQuery(query));
      return { items: items.map(toFeedbackDto), page: query.page, pageSize: query.pageSize, total };
    },

    async listAll(query) {
      const { items, total } = await repository.list({}, toQuery(query));
      return { items: items.map(toAdminFeedbackDto), page: query.page, pageSize: query.pageSize, total };
    },

    async setStatus(id, status) {
      const updated = await repository.updateStatus(id, status);
      if (!updated) throw AppError.notFound("Feedback not found");
      return toAdminFeedbackDto(updated);
    },
  };
}
