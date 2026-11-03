import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createLookupsController } from "./lookups.controller.js";
import { createLookupsRepository } from "./lookups.repository.js";
import { createLookupsService } from "./lookups.service.js";

const searchCitiesQuery = z.object({
  search: z.string().trim().min(2).max(100),
  state: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Route layer: read-only reference data for the forms. */
export function createLookupsRoutes(prisma: PrismaClient) {
  const controller = createLookupsController(createLookupsService(createLookupsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/cities", validate("query", searchCitiesQuery), async (c) => {
      const { body } = await controller.searchCities(c.req.valid("query"));
      return c.json(body);
    })
    .get("/property-catalog", async (c) => {
      const { body } = await controller.propertyCatalog();
      return c.json(body);
    });
}
