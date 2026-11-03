import type { StorageProvider } from "../../lib/storage/storage.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { IMAGE_TYPES, type UploadedFile, assertAcceptable, storageKeyFor } from "../files/file-upload.js";
import { type PhotoDto, toPhotoDto } from "./photos.dto.js";
import type { PhotoScope, PhotosRepository } from "./photos.repository.js";

export const MAX_PHOTOS_PER_PROPERTY = 30;

export interface PhotoContent {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

export interface PhotosService {
  list(tenant: TenantScope, propertyId: string): Promise<PhotoDto[]>;
  upload(tenant: TenantScope, propertyId: string, file: UploadedFile): Promise<PhotoDto>;
  content(tenant: TenantScope, propertyId: string, id: string): Promise<PhotoContent>;
  reorder(tenant: TenantScope, propertyId: string, photoIds: readonly string[]): Promise<PhotoDto[]>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<void>;
}

export interface PhotosServiceOptions {
  maxUploadBytes: number;
}

/** Owners and admins see the whole organization; members only photos of properties they created. */
function visibleScope(tenant: TenantScope): PhotoScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createPhotosService(
  repository: PhotosRepository,
  storage: StorageProvider,
  { maxUploadBytes }: PhotosServiceOptions,
): PhotosService {
  /** An unknown or invisible property is a 404, not an empty list. */
  async function assertProperty(scope: PhotoScope, propertyId: string): Promise<void> {
    if (!(await repository.propertyVisible(scope, propertyId))) throw AppError.notFound("Property not found");
  }

  return {
    async list(tenant, propertyId) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);
      return (await repository.list(scope, propertyId)).map(toPhotoDto);
    },

    async upload(tenant, propertyId, file) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);
      assertAcceptable(file, { allowedTypes: IMAGE_TYPES, maxBytes: maxUploadBytes });
      if ((await repository.count(scope, propertyId)) >= MAX_PHOTOS_PER_PROPERTY) {
        throw AppError.businessRule(`A property can have up to ${MAX_PHOTOS_PER_PROPERTY} photos`);
      }

      // The object goes first: a row that points to nothing is worse than an object nobody points to
      // (the orphan sweep removes those). If the database refuses, the object is taken back.
      const storageKey = storageKeyFor(tenant.organizationId, file.mimeType);
      await storage.put(storageKey, file.bytes, { contentType: file.mimeType });
      try {
        const created = await repository.create(scope, propertyId, {
          uploadedById: tenant.userId,
          storageKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        });
        return toPhotoDto(created);
      } catch (error) {
        await storage.delete(storageKey).catch((cleanup) => console.error("Could not remove the orphan object", cleanup));
        throw error;
      }
    },

    async content(tenant, propertyId, id) {
      const photo = await repository.findById(visibleScope(tenant), propertyId, id);
      if (!photo) throw AppError.notFound("Photo not found");

      const object = await storage.get(photo.file.storageKey);
      if (!object) {
        console.error(`Photo ${id} has no object in the storage (${photo.file.storageKey})`);
        throw AppError.notFound("Photo not found");
      }
      return { bytes: object.body, mimeType: photo.file.mimeType, fileName: photo.file.fileName };
    },

    async reorder(tenant, propertyId, photoIds) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);

      const current = await repository.list(scope, propertyId);
      const known = new Set(current.map((photo) => photo.id));
      const sent = new Set(photoIds);
      if (sent.size !== photoIds.length || sent.size !== known.size || ![...sent].every((id) => known.has(id))) {
        throw AppError.validation([{ path: "photoIds", message: "Send every photo of the property exactly once" }]);
      }

      await repository.reorder(scope, propertyId, photoIds);
      return (await repository.list(scope, propertyId)).map(toPhotoDto);
    },

    async remove(tenant, propertyId, id) {
      const removed = await repository.delete(visibleScope(tenant), propertyId, id);
      if (!removed) throw AppError.notFound("Photo not found");
      // The rows are gone; if the object cannot be deleted now the orphan sweep will find it.
      await storage.delete(removed.storageKey).catch((error) => console.error("Could not delete the object", error));
    },
  };
}
