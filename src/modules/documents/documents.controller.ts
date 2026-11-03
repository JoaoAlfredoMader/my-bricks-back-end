import type { TenantScope } from "../../shared/http/tenant.js";
import type { UploadedFile } from "../files/file-upload.js";
import type { DocumentDto } from "./documents.dto.js";
import type { DocumentContent, DocumentsService } from "./documents.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface DocumentsController {
  list(tenant: TenantScope, propertyId: string, filter: { category?: string | undefined }): Promise<HttpResult<DocumentDto[]>>;
  upload(tenant: TenantScope, propertyId: string, file: UploadedFile, category: string | null): Promise<HttpResult<DocumentDto, 201>>;
  content(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<DocumentContent>>;
  updateCategory(tenant: TenantScope, propertyId: string, id: string, category: string | null): Promise<HttpResult<DocumentDto>>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<null, 204>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createDocumentsController(service: DocumentsService): DocumentsController {
  return {
    async list(tenant, propertyId, filter) {
      return { status: 200, body: await service.list(tenant, propertyId, filter) };
    },
    async upload(tenant, propertyId, file, category) {
      return { status: 201, body: await service.upload(tenant, propertyId, file, category) };
    },
    async content(tenant, propertyId, id) {
      return { status: 200, body: await service.content(tenant, propertyId, id) };
    },
    async updateCategory(tenant, propertyId, id, category) {
      return { status: 200, body: await service.updateCategory(tenant, propertyId, id, category) };
    },
    async remove(tenant, propertyId, id) {
      await service.remove(tenant, propertyId, id);
      return { status: 204, body: null };
    },
  };
}
