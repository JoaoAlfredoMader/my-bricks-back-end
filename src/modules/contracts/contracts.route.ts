import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createContractsController } from "./contracts.controller.js";
import { createContractsRepository } from "./contracts.repository.js";
import {
  contractIdParamSchema,
  createContractSchema,
  endContractSchema,
  listContractsQuerySchema,
  updateContractSchema,
} from "./contracts.schemas.js";
import { createContractsService } from "./contracts.service.js";

/**
 * Route layer: HTTP binding (path, validation, serialization).
 * Contracts are never deleted: they are ended or cancelled, so the history stays.
 */
export function createContractsRoutes(prisma: PrismaClient) {
  const controller = createContractsController(createContractsService(createContractsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listContractsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", validate("json", createContractSchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", contractIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", validate("param", contractIdParamSchema), validate("json", updateContractSchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .post("/:id/end", validate("param", contractIdParamSchema), validate("json", endContractSchema), async (c) => {
      const { body } = await controller.end(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .post("/:id/cancel", validate("param", contractIdParamSchema), async (c) => {
      const { body } = await controller.cancel(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    });
}
