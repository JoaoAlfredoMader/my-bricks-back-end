import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { PrismaClient } from "../../lib/prisma.js";
import type { StorageProvider } from "../../lib/storage/storage.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { contentDisposition, readUpload } from "../files/file-upload.js";
import { createPhotosController } from "./photos.controller.js";
import { createPhotosRepository } from "./photos.repository.js";
import { photoParamsSchema, propertyParamSchema, reorderPhotosSchema, uploadPhotoSchema } from "./photos.schemas.js";
import { createPhotosService } from "./photos.service.js";

/** Slack for the multipart envelope around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Route layer. Mounted under `/api/properties/:propertyId/photos`. */
export function createPhotosRoutes(prisma: PrismaClient, storage: StorageProvider, maxUploadBytes: number) {
  const controller = createPhotosController(createPhotosService(createPhotosRepository(prisma), storage, { maxUploadBytes }));
  const limit = bodyLimit({
    maxSize: maxUploadBytes + MULTIPART_OVERHEAD_BYTES,
    onError: () => {
      throw AppError.payloadTooLarge(maxUploadBytes);
    },
  });

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("param", propertyParamSchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("param").propertyId);
      return c.json(body);
    })
    .post("/", limit, audited("upload", "photo"), validate("param", propertyParamSchema), validate("form", uploadPhotoSchema), async (c) => {
      const file = await readUpload(c.req.valid("form").file);
      const { status, body } = await controller.upload(tenantScope(c), c.req.valid("param").propertyId, file);
      return c.json(body, status);
    })
    .put("/order", validate("param", propertyParamSchema), validate("json", reorderPhotosSchema), async (c) => {
      const { body } = await controller.reorder(tenantScope(c), c.req.valid("param").propertyId, c.req.valid("json").photoIds);
      return c.json(body);
    })
    .get("/:id/content", validate("param", photoParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      const { body } = await controller.content(tenantScope(c), propertyId, id);
      return c.body(new Uint8Array(body.bytes), 200, {
        "content-type": body.mimeType,
        "content-length": String(body.bytes.length),
        "content-disposition": contentDisposition("inline", body.fileName),
        // Private: the response depends on the session. nosniff: never let a browser guess a different type.
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
    })
    .delete("/:id", audited("delete", "photo"), validate("param", photoParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      await controller.remove(tenantScope(c), propertyId, id);
      return c.body(null, 204);
    });
}
