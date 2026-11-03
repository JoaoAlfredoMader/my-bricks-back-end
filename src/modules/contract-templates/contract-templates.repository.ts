import type { PrismaClient } from "../../lib/prisma.js";

export interface TemplateRecord {
  header: string;
  clauses: string;
  footer: string;
  updatedById: string | null;
  updatedAt: Date;
}

export interface TemplateData {
  header: string;
  clauses: string;
  footer: string;
}

export interface ContractTemplatesRepository {
  find(organizationId: string): Promise<TemplateRecord | null>;
  save(organizationId: string, updatedById: string, data: TemplateData): Promise<TemplateRecord>;
  /** Returns whether the organization had a template of its own. */
  delete(organizationId: string): Promise<boolean>;
}

const select = { header: true, clauses: true, footer: true, updatedById: true, updatedAt: true } as const;

/** Repository layer: the only place that talks to Prisma. One template per organization. */
export function createContractTemplatesRepository(prisma: PrismaClient): ContractTemplatesRepository {
  return {
    find(organizationId) {
      return prisma.contractTemplate.findUnique({ where: { organizationId }, select });
    },

    save(organizationId, updatedById, data) {
      return prisma.contractTemplate.upsert({
        where: { organizationId },
        create: { organizationId, updatedById, ...data },
        update: { updatedById, ...data },
        select,
      });
    },

    async delete(organizationId) {
      const { count } = await prisma.contractTemplate.deleteMany({ where: { organizationId } });
      return count > 0;
    },
  };
}
