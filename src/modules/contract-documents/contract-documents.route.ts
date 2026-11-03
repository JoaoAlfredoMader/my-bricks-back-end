import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { StorageProvider } from "../../lib/storage/storage.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createContractTemplatesRepository } from "../contract-templates/contract-templates.repository.js";
import { contentDisposition } from "../files/file-upload.js";
import { createContractDocumentsController } from "./contract-documents.controller.js";
import { createContractDocumentsRepository } from "./contract-documents.repository.js";
import { createContractDocumentsService } from "./contract-documents.service.js";

export const contractPdfParamSchema = z.object({ id: z.uuid() });

/** Route layer. Mounted under `/api/contracts/:id/pdf`. */
export function createContractDocumentsRoutes(prisma: PrismaClient, storage: StorageProvider) {
  const controller = createContractDocumentsController(
    createContractDocumentsService(
      createContractDocumentsRepository(prisma),
      createContractTemplatesRepository(prisma),
      storage,
    ),
  );

  return new Hono<AppEnv>()
    .use(requireAuth)
    .post("/", audited("generate_pdf", "contract"), validate("param", contractPdfParamSchema), async (c) => {
      const { body } = await controller.generate(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .get("/", validate("param", contractPdfParamSchema), async (c) => {
      const { body } = await controller.download(tenantScope(c), c.req.valid("param").id);
      return c.body(new Uint8Array(body.bytes), 200, {
        "content-type": "application/pdf",
        "content-length": String(body.bytes.length),
        "content-disposition": contentDisposition("attachment", body.fileName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    });
}
