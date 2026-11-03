import type { StorageProvider } from "../../lib/storage/storage.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { DOCUMENT_TYPES, type UploadedFile, assertAcceptable, storageKeyFor } from "../files/file-upload.js";
import { type DocumentDto, toDocumentDto } from "./documents.dto.js";
import type { DocumentScope, DocumentsRepository } from "./documents.repository.js";

export interface DocumentContent {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

export interface DocumentsService {
  list(tenant: TenantScope, propertyId: string, filter: { category?: string | undefined }): Promise<DocumentDto[]>;
  upload(tenant: TenantScope, propertyId: string, file: UploadedFile, category: string | null): Promise<DocumentDto>;
  content(tenant: TenantScope, propertyId: string, id: string): Promise<DocumentContent>;
  updateCategory(tenant: TenantScope, propertyId: string, id: string, category: string | null): Promise<DocumentDto>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<void>;
}

export interface DocumentsServiceOptions {
  maxUploadBytes: number;
}

/** Owners and admins see the whole organization; members only documents of properties they created. */
function visibleScope(tenant: TenantScope): DocumentScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createDocumentsService(
  repository: DocumentsRepository,
  storage: StorageProvider,
  { maxUploadBytes }: DocumentsServiceOptions,
): DocumentsService {
  async function assertProperty(scope: DocumentScope, propertyId: string): Promise<void> {
    if (!(await repository.propertyVisible(scope, propertyId))) throw AppError.notFound("Property not found");
  }

  return {
    async list(tenant, propertyId, { category }) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);
      return (await repository.list(scope, propertyId, category ? { category } : {})).map(toDocumentDto);
    },

    async upload(tenant, propertyId, file, category) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);
      assertAcceptable(file, { allowedTypes: DOCUMENT_TYPES, maxBytes: maxUploadBytes });

      // The object goes first; if the database refuses, the object is taken back.
      const storageKey = storageKeyFor(tenant.organizationId, file.mimeType);
      await storage.put(storageKey, file.bytes, { contentType: file.mimeType });
      try {
        const created = await repository.create(
          scope,
          propertyId,
          { uploadedById: tenant.userId, storageKey, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
          category,
        );
        return toDocumentDto(created);
      } catch (error) {
        await storage.delete(storageKey).catch((cleanup) => console.error("Could not remove the orphan object", cleanup));
        throw error;
      }
    },

    async content(tenant, propertyId, id) {
      const document = await repository.findById(visibleScope(tenant), propertyId, id);
      if (!document) throw AppError.notFound("Document not found");

      const object = await storage.get(document.file.storageKey);
      if (!object) {
        console.error(`Document ${id} has no object in the storage (${document.file.storageKey})`);
        throw AppError.notFound("Document not found");
      }
      return { bytes: object.body, mimeType: document.file.mimeType, fileName: document.file.fileName };
    },

    async updateCategory(tenant, propertyId, id, category) {
      const updated = await repository.updateCategory(visibleScope(tenant), propertyId, id, category);
      if (!updated) throw AppError.notFound("Document not found");
      return toDocumentDto(updated);
    },

    async remove(tenant, propertyId, id) {
      const removed = await repository.delete(visibleScope(tenant), propertyId, id);
      if (!removed) throw AppError.notFound("Document not found");
      // The rows are gone; if the object cannot be deleted now the orphan sweep will find it.
      await storage.delete(removed.storageKey).catch((error) => console.error("Could not delete the object", error));
    },
  };
}
