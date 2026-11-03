import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createClientsController } from "./clients.controller.js";
import { createClientsRepository } from "./clients.repository.js";
import { clientIdParamSchema, createClientSchema, listClientsQuerySchema, updateClientSchema } from "./clients.schemas.js";
import { createClientsService } from "./clients.service.js";

/** Route layer: HTTP binding (path, validation, serialization). */
export function createClientsRoutes(prisma: PrismaClient) {
  const controller = createClientsController(createClientsService(createClientsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listClientsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", validate("json", createClientSchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", clientIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", validate("param", clientIdParamSchema), validate("json", updateClientSchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .delete("/:id", validate("param", clientIdParamSchema), async (c) => {
      await controller.remove(tenantScope(c), c.req.valid("param").id);
      return c.body(null, 204);
    });
}
