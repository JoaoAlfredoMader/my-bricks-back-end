import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

export interface OccupantRecord {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Occupants (tenants and guests) belong to the organization, not to a member. A member only sees
 * the ones that appear in contracts of properties they created.
 */
export interface OccupantScope {
  organizationId: string;
  visibleToUserId?: string;
}

export interface OccupantData {
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
}

/** What other modules need to know about stored occupants before attaching one to a record. */
export interface OccupantLookup {
  occupantExists(organizationId: string, occupantId: string): Promise<boolean>;
  findOccupantIdByDocument(organizationId: string, document: string): Promise<string | null>;
}

export function createOccupantLookup(prisma: PrismaClient): OccupantLookup {
  return {
    async occupantExists(organizationId, occupantId) {
      return (await prisma.occupant.count({ where: { id: occupantId, organizationId } })) > 0;
    },

    async findOccupantIdByDocument(organizationId, document) {
      const occupant = await prisma.occupant.findFirst({ where: { organizationId, document }, select: { id: true } });
      return occupant?.id ?? null;
    },
  };
}

export interface OccupantsRepository {
  list(
    scope: OccupantScope,
    query: { search?: string; skip: number; take: number },
  ): Promise<{ items: OccupantRecord[]; total: number }>;
}

const select = { id: true, name: true, document: true, email: true, phone: true } satisfies Prisma.OccupantSelect;

/** Repository layer: the only place that talks to Prisma. */
export function createOccupantsRepository(prisma: PrismaClient): OccupantsRepository {
  return {
    async list(scope, { search, skip, take }) {
      const where: Prisma.OccupantWhereInput = {
        organizationId: scope.organizationId,
        ...(scope.visibleToUserId
          ? { contracts: { some: { property: { createdById: scope.visibleToUserId } } } }
          : {}),
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
        prisma.occupant.findMany({ where, select, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take }),
        prisma.occupant.count({ where }),
      ]);
      return { items, total };
    },
  };
}
