import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createContractTemplatesController } from "./contract-templates.controller.js";
import { createContractTemplatesRepository } from "./contract-templates.repository.js";
import { updateTemplateSchema } from "./contract-templates.schemas.js";
import { createContractTemplatesService } from "./contract-templates.service.js";

/** Route layer: the organization's contract template, one per organization. */
export function createContractTemplatesRoutes(prisma: PrismaClient) {
  const controller = createContractTemplatesController(
    createContractTemplatesService(createContractTemplatesRepository(prisma)),
  );

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", async (c) => {
      const { body } = await controller.get(tenantScope(c));
      return c.json(body);
    })
    .put("/", audited("update", "organization"), validate("json", updateTemplateSchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("json"));
      return c.json(body);
    })
    .delete("/", audited("update", "organization"), async (c) => {
      const { body } = await controller.reset(tenantScope(c));
      return c.json(body);
    });
}
