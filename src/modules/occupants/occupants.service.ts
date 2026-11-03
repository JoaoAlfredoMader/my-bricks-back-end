import type { TenantScope } from "../../shared/http/tenant.js";
import type { OccupantRecord, OccupantsRepository } from "./occupants.repository.js";

export type OccupantDto = OccupantRecord;

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OccupantsService {
  list(tenant: TenantScope, query: { page: number; pageSize: number; search?: string }): Promise<Page<OccupantDto>>;
}

/** Service layer: who may see which occupants. No HTTP, no Prisma. */
export function createOccupantsService(repository: OccupantsRepository): OccupantsService {
  return {
    async list(tenant, { page, pageSize, search }) {
      const { items, total } = await repository.list(
        {
          organizationId: tenant.organizationId,
          ...(tenant.canSeeAll ? {} : { visibleToUserId: tenant.userId }),
        },
        { ...(search ? { search } : {}), skip: (page - 1) * pageSize, take: pageSize },
      );
      return { items, page, pageSize, total };
    },
  };
}
