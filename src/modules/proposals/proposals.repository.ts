import type { Prisma } from "../../generated/prisma/client.js";
import type { ProposalType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  propertyId: true,
  proposalType: true,
  amountCents: true,
  proposalDate: true,
  contact: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.PropertyProposalSelect;

export type ProposalRecord = Prisma.PropertyProposalGetPayload<{ select: typeof select }>;

/** Proposals belong to a property: members only reach those of properties they created. */
export interface ProposalScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface ProposalData {
  proposalType: ProposalType;
  amountCents: bigint;
  proposalDate: Date;
  contact: string | null;
  notes: string | null;
}

export interface ProposalsRepository {
  propertyVisible(scope: ProposalScope, propertyId: string): Promise<boolean>;
  list(
    scope: ProposalScope,
    propertyId: string,
    query: { proposalType?: ProposalType; skip: number; take: number },
  ): Promise<{ items: ProposalRecord[]; total: number }>;
  findById(scope: ProposalScope, propertyId: string, id: string): Promise<ProposalRecord | null>;
  create(propertyId: string, data: ProposalData): Promise<ProposalRecord>;
  update(scope: ProposalScope, propertyId: string, id: string, patch: Partial<ProposalData>): Promise<ProposalRecord | null>;
  delete(scope: ProposalScope, propertyId: string, id: string): Promise<boolean>;
}

/** The proposal is reached through its property, so the tenant and visibility filter sit on the property. */
function whereFor(scope: ProposalScope, propertyId: string): Prisma.PropertyProposalWhereInput {
  return {
    propertyId,
    property: {
      organizationId: scope.organizationId,
      ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
    },
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createProposalsRepository(prisma: PrismaClient): ProposalsRepository {
  return {
    async propertyVisible(scope, propertyId) {
      const count = await prisma.property.count({
        where: {
          id: propertyId,
          organizationId: scope.organizationId,
          ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
        },
      });
      return count > 0;
    },

    async list(scope, propertyId, { proposalType, skip, take }) {
      const where: Prisma.PropertyProposalWhereInput = {
        ...whereFor(scope, propertyId),
        ...(proposalType ? { proposalType } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.propertyProposal.findMany({
          where,
          select,
          orderBy: [{ proposalDate: "desc" }, { createdAt: "desc" }, { id: "asc" }],
          skip,
          take,
        }),
        prisma.propertyProposal.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, propertyId, id) {
      return prisma.propertyProposal.findFirst({ where: { ...whereFor(scope, propertyId), id }, select });
    },

    create(propertyId, data) {
      return prisma.propertyProposal.create({ data: { ...data, propertyId }, select });
    },

    async update(scope, propertyId, id, patch) {
      const { count } = await prisma.propertyProposal.updateMany({
        where: { ...whereFor(scope, propertyId), id },
        data: patch,
      });
      if (count === 0) return null;
      return prisma.propertyProposal.findFirst({ where: { ...whereFor(scope, propertyId), id }, select });
    },

    async delete(scope, propertyId, id) {
      const { count } = await prisma.propertyProposal.deleteMany({ where: { ...whereFor(scope, propertyId), id } });
      return count > 0;
    },
  };
}
