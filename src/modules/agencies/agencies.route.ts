import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createAgenciesController } from "./agencies.controller.js";
import { createAgenciesRepository } from "./agencies.repository.js";
import { createAgenciesService } from "./agencies.service.js";

export const agencyBodySchema = z.object({ name: z.string().trim().min(2).max(255) });
export const listAgenciesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});
export const agencyIdParamSchema = z.object({ id: z.uuid() });

/** Route layer: HTTP binding (path, validation, serialization). */
export function createAgenciesRoutes(prisma: PrismaClient) {
  const controller = createAgenciesController(createAgenciesService(createAgenciesRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listAgenciesQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", validate("json", agencyBodySchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", agencyIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", validate("param", agencyIdParamSchema), validate("json", agencyBodySchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .delete("/:id", validate("param", agencyIdParamSchema), async (c) => {
      await controller.remove(tenantScope(c), c.req.valid("param").id);
      return c.body(null, 204);
    });
}
