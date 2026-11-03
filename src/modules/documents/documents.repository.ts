import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  propertyId: true,
  category: true,
  createdAt: true,
  file: { select: { storageKey: true, fileName: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.PropertyDocumentSelect;

export type DocumentRecord = Prisma.PropertyDocumentGetPayload<{ select: typeof select }>;

/** Documents belong to a property: members only reach those of properties they created. */
export interface DocumentScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface NewDocumentFile {
  uploadedById: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DocumentsRepository {
  propertyVisible(scope: DocumentScope, propertyId: string): Promise<boolean>;
  list(scope: DocumentScope, propertyId: string, filter: { category?: string }): Promise<DocumentRecord[]>;
  findById(scope: DocumentScope, propertyId: string, id: string): Promise<DocumentRecord | null>;
  /** Records the file and attaches it to the property, in one transaction. */
  create(scope: DocumentScope, propertyId: string, file: NewDocumentFile, category: string | null): Promise<DocumentRecord>;
  updateCategory(scope: DocumentScope, propertyId: string, id: string, category: string | null): Promise<DocumentRecord | null>;
  /** Removes the document and its file record. Returns the storage key so the caller can delete the object. */
  delete(scope: DocumentScope, propertyId: string, id: string): Promise<{ storageKey: string } | null>;
}

function whereFor(scope: DocumentScope, propertyId: string): Prisma.PropertyDocumentWhereInput {
  return {
    propertyId,
    property: {
      organizationId: scope.organizationId,
      ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
    },
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createDocumentsRepository(prisma: PrismaClient): DocumentsRepository {
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

    list(scope, propertyId, { category }) {
      return prisma.propertyDocument.findMany({
        where: { ...whereFor(scope, propertyId), ...(category ? { category: { equals: category, mode: "insensitive" } } : {}) },
        select,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
    },

    findById(scope, propertyId, id) {
      return prisma.propertyDocument.findFirst({ where: { ...whereFor(scope, propertyId), id }, select });
    },

    create(scope, propertyId, file, category) {
      return prisma.$transaction(async (tx) => {
        const stored = await tx.storedFile.create({
          data: { ...file, organizationId: scope.organizationId, sizeBytes: BigInt(file.sizeBytes) },
          select: { id: true },
        });
        return tx.propertyDocument.create({
          data: { organizationId: scope.organizationId, propertyId, fileId: stored.id, category },
          select,
        });
      });
    },

    async updateCategory(scope, propertyId, id, category) {
      const { count } = await prisma.propertyDocument.updateMany({ where: { ...whereFor(scope, propertyId), id }, data: { category } });
      if (count === 0) return null;
      return prisma.propertyDocument.findFirst({ where: { ...whereFor(scope, propertyId), id }, select });
    },

    delete(scope, propertyId, id) {
      return prisma.$transaction(async (tx) => {
        const document = await tx.propertyDocument.findFirst({
          where: { ...whereFor(scope, propertyId), id },
          select: { fileId: true, file: { select: { storageKey: true } } },
        });
        if (!document) return null;
        await tx.propertyDocument.delete({ where: { id } });
        await tx.storedFile.delete({ where: { id: document.fileId } });
        return { storageKey: document.file.storageKey };
      });
    },
  };
}
