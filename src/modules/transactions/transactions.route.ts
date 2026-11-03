import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createTransactionsController } from "./transactions.controller.js";
import { createTransactionsRepository } from "./transactions.repository.js";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
  updateTransactionSchema,
} from "./transactions.schemas.js";
import { createTransactionsService } from "./transactions.service.js";

/** Route layer: HTTP binding (path, validation, serialization). */
export function createTransactionsRoutes(prisma: PrismaClient) {
  const controller = createTransactionsController(createTransactionsService(createTransactionsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listTransactionsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", audited("create", "transaction"), validate("json", createTransactionSchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", transactionIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", audited("update", "transaction"), validate("param", transactionIdParamSchema), validate("json", updateTransactionSchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .delete("/:id", audited("delete", "transaction"), validate("param", transactionIdParamSchema), async (c) => {
      await controller.remove(tenantScope(c), c.req.valid("param").id);
      return c.body(null, 204);
    });
}
