import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  propertyId: true,
  position: true,
  createdAt: true,
  file: { select: { storageKey: true, fileName: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.PropertyPhotoSelect;

export type PhotoRecord = Prisma.PropertyPhotoGetPayload<{ select: typeof select }>;

/** Photos belong to a property: members only reach those of properties they created. */
export interface PhotoScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface NewPhotoFile {
  uploadedById: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PhotosRepository {
  propertyVisible(scope: PhotoScope, propertyId: string): Promise<boolean>;
  count(scope: PhotoScope, propertyId: string): Promise<number>;
  list(scope: PhotoScope, propertyId: string): Promise<PhotoRecord[]>;
  findById(scope: PhotoScope, propertyId: string, id: string): Promise<PhotoRecord | null>;
  /** Records the file and attaches it at the end of the property's photos, in one transaction. */
  create(scope: PhotoScope, propertyId: string, file: NewPhotoFile): Promise<PhotoRecord>;
  /** Rewrites the positions in the given order (0, 1, 2...). */
  reorder(scope: PhotoScope, propertyId: string, orderedIds: readonly string[]): Promise<void>;
  /** Removes the photo and its file record. Returns the storage key so the caller can delete the object. */
  delete(scope: PhotoScope, propertyId: string, id: string): Promise<{ storageKey: string } | null>;
}

function whereFor(scope: PhotoScope, propertyId: string): Prisma.PropertyPhotoWhereInput {
  return {
    propertyId,
    property: {
      organizationId: scope.organizationId,
      ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
    },
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createPhotosRepository(prisma: PrismaClient): PhotosRepository {
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

    count(scope, propertyId) {
      return prisma.propertyPhoto.count({ where: whereFor(scope, propertyId) });
    },

    list(scope, propertyId) {
      return prisma.propertyPhoto.findMany({
        where: whereFor(scope, propertyId),
        select,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
    },

    findById(scope, propertyId, id) {
      return prisma.propertyPhoto.findFirst({ where: { ...whereFor(scope, propertyId), id }, select });
    },

    create(scope, propertyId, file) {
      return prisma.$transaction(async (tx) => {
        const last = await tx.propertyPhoto.aggregate({ where: { propertyId }, _max: { position: true } });
        const stored = await tx.storedFile.create({
          data: { ...file, organizationId: scope.organizationId, sizeBytes: BigInt(file.sizeBytes) },
          select: { id: true },
        });
        return tx.propertyPhoto.create({
          data: {
            organizationId: scope.organizationId,
            propertyId,
            fileId: stored.id,
            position: (last._max.position ?? -1) + 1,
          },
          select,
        });
      });
    },

    async reorder(scope, propertyId, orderedIds) {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.propertyPhoto.updateMany({ where: { ...whereFor(scope, propertyId), id }, data: { position } }),
        ),
      );
    },

    delete(scope, propertyId, id) {
      return prisma.$transaction(async (tx) => {
        const photo = await tx.propertyPhoto.findFirst({
          where: { ...whereFor(scope, propertyId), id },
          select: { fileId: true, file: { select: { storageKey: true } } },
        });
        if (!photo) return null;
        await tx.propertyPhoto.delete({ where: { id } });
        await tx.storedFile.delete({ where: { id: photo.fileId } });
        return { storageKey: photo.file.storageKey };
      });
    },
  };
}
