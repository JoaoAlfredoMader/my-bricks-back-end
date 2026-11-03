import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";

export interface AgencyRecord {
  id: string;
  name: string;
}

export interface AgenciesRepository {
  list(
    organizationId: string,
    query: { search?: string; skip: number; take: number },
  ): Promise<{ items: AgencyRecord[]; total: number }>;
  findById(organizationId: string, id: string): Promise<AgencyRecord | null>;
  create(organizationId: string, name: string): Promise<AgencyRecord>;
  update(organizationId: string, id: string, name: string): Promise<AgencyRecord | null>;
  countProperties(organizationId: string, id: string): Promise<number>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

const select = { id: true, name: true } satisfies Prisma.AgencySelect;

/** `(organization_id, name)` is unique: two agencies with the same name are a conflict. */
function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw AppError.conflict("An agency with this name already exists", { field: "name" });
  }
  throw error;
}

/** Repository layer: the only place that talks to Prisma. Agencies belong to the organization, not to a member. */
export function createAgenciesRepository(prisma: PrismaClient): AgenciesRepository {
  return {
    async list(organizationId, { search, skip, take }) {
      const where: Prisma.AgencyWhereInput = {
        organizationId,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.agency.findMany({ where, select, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take }),
        prisma.agency.count({ where }),
      ]);
      return { items, total };
    },

    findById(organizationId, id) {
      return prisma.agency.findFirst({ where: { id, organizationId }, select });
    },

    async create(organizationId, name) {
      try {
        return await prisma.agency.create({ data: { organizationId, name }, select });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    async update(organizationId, id, name) {
      try {
        const { count } = await prisma.agency.updateMany({ where: { id, organizationId }, data: { name } });
        if (count === 0) return null;
        return await prisma.agency.findFirst({ where: { id, organizationId }, select });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    countProperties(organizationId, id) {
      return prisma.property.count({ where: { organizationId, agencyId: id } });
    },

    async delete(organizationId, id) {
      const { count } = await prisma.agency.deleteMany({ where: { id, organizationId } });
      return count > 0;
    },
  };
}
