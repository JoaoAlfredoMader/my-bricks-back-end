import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createOccupantsController } from "./occupants.controller.js";
import { createOccupantsRepository } from "./occupants.repository.js";
import { createOccupantsService } from "./occupants.service.js";

export const listOccupantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});

/**
 * Route layer. Occupants are created together with a contract (see the contracts module);
 * this endpoint only lists them so a new contract can reuse one.
 */
export function createOccupantsRoutes(prisma: PrismaClient) {
  const controller = createOccupantsController(createOccupantsService(createOccupantsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listOccupantsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    });
}
