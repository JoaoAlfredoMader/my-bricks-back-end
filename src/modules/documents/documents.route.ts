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
import { createDocumentsController } from "./documents.controller.js";
import { createDocumentsRepository } from "./documents.repository.js";
import {
  documentParamsSchema,
  listDocumentsQuerySchema,
  propertyParamSchema,
  updateDocumentSchema,
  uploadDocumentSchema,
} from "./documents.schemas.js";
import { createDocumentsService } from "./documents.service.js";

/** Slack for the multipart envelope around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Route layer. Mounted under `/api/properties/:propertyId/documents`. */
export function createDocumentsRoutes(prisma: PrismaClient, storage: StorageProvider, maxUploadBytes: number) {
  const controller = createDocumentsController(createDocumentsService(createDocumentsRepository(prisma), storage, { maxUploadBytes }));
  const limit = bodyLimit({
    maxSize: maxUploadBytes + MULTIPART_OVERHEAD_BYTES,
    onError: () => {
      throw AppError.payloadTooLarge(maxUploadBytes);
    },
  });

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("param", propertyParamSchema), validate("query", listDocumentsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("param").propertyId, c.req.valid("query"));
      return c.json(body);
    })
    .post("/", limit, audited("upload", "document"), validate("param", propertyParamSchema), validate("form", uploadDocumentSchema), async (c) => {
      const { file, category } = c.req.valid("form");
      const { status, body } = await controller.upload(tenantScope(c), c.req.valid("param").propertyId, await readUpload(file), category ?? null);
      return c.json(body, status);
    })
    .get("/:id/content", validate("param", documentParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      const { body } = await controller.content(tenantScope(c), propertyId, id);
      return c.body(new Uint8Array(body.bytes), 200, {
        "content-type": body.mimeType,
        "content-length": String(body.bytes.length),
        // Always a download: a document is never rendered inside the app's origin.
        "content-disposition": contentDisposition("attachment", body.fileName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    })
    .patch("/:id", audited("update", "document"), validate("param", documentParamsSchema), validate("json", updateDocumentSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      const { body } = await controller.updateCategory(tenantScope(c), propertyId, id, c.req.valid("json").category);
      return c.json(body);
    })
    .delete("/:id", audited("delete", "document"), validate("param", documentParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      await controller.remove(tenantScope(c), propertyId, id);
      return c.body(null, 204);
    });
}
