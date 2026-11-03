import type { TenantScope } from "../../shared/http/tenant.js";
import type { UploadedFile } from "../files/file-upload.js";
import type { PhotoDto } from "./photos.dto.js";
import type { PhotoContent, PhotosService } from "./photos.service.js";

export interface HttpResult<TBody, TStatus extends number = 200> {
  status: TStatus;
  body: TBody;
}

export interface PhotosController {
  list(tenant: TenantScope, propertyId: string): Promise<HttpResult<PhotoDto[]>>;
  upload(tenant: TenantScope, propertyId: string, file: UploadedFile): Promise<HttpResult<PhotoDto, 201>>;
  content(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<PhotoContent>>;
  reorder(tenant: TenantScope, propertyId: string, photoIds: readonly string[]): Promise<HttpResult<PhotoDto[]>>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<HttpResult<null, 204>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createPhotosController(service: PhotosService): PhotosController {
  return {
    async list(tenant, propertyId) {
      return { status: 200, body: await service.list(tenant, propertyId) };
    },
    async upload(tenant, propertyId, file) {
      return { status: 201, body: await service.upload(tenant, propertyId, file) };
    },
    async content(tenant, propertyId, id) {
      return { status: 200, body: await service.content(tenant, propertyId, id) };
    },
    async reorder(tenant, propertyId, photoIds) {
      return { status: 200, body: await service.reorder(tenant, propertyId, photoIds) };
    },
    async remove(tenant, propertyId, id) {
      await service.remove(tenant, propertyId, id);
      return { status: 204, body: null };
    },
  };
}
