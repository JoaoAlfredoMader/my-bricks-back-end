import { Prisma } from "../../generated/prisma/client.js";
import type { PersonType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";

export interface ClientRecord {
  id: string;
  createdById: string;
  name: string;
  personType: PersonType;
  document: string | null;
  email: string | null;
  whatsapp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Every query is bound to one organization; members are further limited to what they created. */
export interface ClientScope {
  organizationId: string;
  createdById?: string;
}

export interface ClientListQuery {
  search?: string;
  personType?: PersonType;
  skip: number;
  take: number;
}

export interface ClientData {
  name: string;
  personType: PersonType;
  document: string | null;
  email: string | null;
  whatsapp: string | null;
}

export interface ClientsRepository {
  list(scope: ClientScope, query: ClientListQuery): Promise<{ items: ClientRecord[]; total: number }>;
  findById(scope: ClientScope, id: string): Promise<ClientRecord | null>;
  create(scope: ClientScope & { createdById: string }, data: ClientData): Promise<ClientRecord>;
  update(scope: ClientScope, id: string, data: Partial<ClientData>): Promise<ClientRecord | null>;
  countProperties(scope: ClientScope, id: string): Promise<number>;
  delete(scope: ClientScope, id: string): Promise<boolean>;
}

const select = {
  id: true,
  createdById: true,
  name: true,
  personType: true,
  document: true,
  email: true,
  whatsapp: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

function whereFor(scope: ClientScope): Prisma.ClientWhereInput {
  return {
    organizationId: scope.organizationId,
    ...(scope.createdById ? { createdById: scope.createdById } : {}),
  };
}

/** `(organization_id, document)` is unique: a second client with the same CPF/CNPJ is a conflict. */
function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw AppError.conflict("A client with this document already exists", { field: "document" });
  }
  throw error;
}

/** Repository layer: the only place that talks to Prisma. */
export function createClientsRepository(prisma: PrismaClient): ClientsRepository {
  return {
    async list(scope, { search, personType, skip, take }) {
      const where: Prisma.ClientWhereInput = {
        ...whereFor(scope),
        ...(personType ? { personType } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { document: { contains: search.toUpperCase() } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.client.findMany({ where, select, orderBy: { name: "asc" }, skip, take }),
        prisma.client.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, id) {
      return prisma.client.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    async create(scope, data) {
      try {
        return await prisma.client.create({
          data: { ...data, organizationId: scope.organizationId, createdById: scope.createdById },
          select,
        });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    async update(scope, id, data) {
      try {
        // updateMany takes the scope in the filter, so a record outside it is simply not touched.
        const { count } = await prisma.client.updateMany({ where: { ...whereFor(scope), id }, data });
        if (count === 0) return null;
        return await prisma.client.findFirst({ where: { ...whereFor(scope), id }, select });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    countProperties(scope, id) {
      return prisma.property.count({ where: { organizationId: scope.organizationId, clientId: id } });
    },

    async delete(scope, id) {
      const { count } = await prisma.client.deleteMany({ where: { ...whereFor(scope), id } });
      return count > 0;
    },
  };
}
