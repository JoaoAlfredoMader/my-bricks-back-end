import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import type { AgenciesRepository, AgencyRecord } from "./agencies.repository.js";

export type AgencyDto = AgencyRecord;

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AgenciesService {
  list(tenant: TenantScope, query: { page: number; pageSize: number; search?: string | undefined }): Promise<Page<AgencyDto>>;
  get(tenant: TenantScope, id: string): Promise<AgencyDto>;
  create(tenant: TenantScope, input: { name: string }): Promise<AgencyDto>;
  update(tenant: TenantScope, id: string, input: { name: string }): Promise<AgencyDto>;
  remove(tenant: TenantScope, id: string): Promise<void>;
}

/** Service layer: business rules. Every member of the organization shares its agencies. */
export function createAgenciesService(repository: AgenciesRepository): AgenciesService {
  return {
    async list(tenant, { page, pageSize, search }) {
      const { items, total } = await repository.list(tenant.organizationId, {
        ...(search ? { search } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, page, pageSize, total };
    },

    async get(tenant, id) {
      const agency = await repository.findById(tenant.organizationId, id);
      if (!agency) throw AppError.notFound("Agency not found");
      return agency;
    },

    create: (tenant, { name }) => repository.create(tenant.organizationId, name),

    async update(tenant, id, { name }) {
      const agency = await repository.update(tenant.organizationId, id, name);
      if (!agency) throw AppError.notFound("Agency not found");
      return agency;
    },

    async remove(tenant, id) {
      if (!(await repository.findById(tenant.organizationId, id))) throw AppError.notFound("Agency not found");

      const properties = await repository.countProperties(tenant.organizationId, id);
      if (properties > 0) {
        throw AppError.conflict("Agency still manages properties. Move or remove them first.", { properties });
      }
      await repository.delete(tenant.organizationId, id);
    },
  };
}
