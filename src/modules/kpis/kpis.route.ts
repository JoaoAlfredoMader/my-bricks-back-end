import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createKpisController } from "./kpis.controller.js";
import { createKpisRepository } from "./kpis.repository.js";
import { createKpisService } from "./kpis.service.js";

/** Calculate as of this date (`YYYY-MM-DD`); defaults to today. */
const asOf = z.iso.date().optional();

const portfolioQuery = z.object({ asOf, clientId: z.uuid().optional() });
const propertyQuery = z.object({ asOf });
const propertyParam = z.object({ id: z.uuid() });

/** Route layer: read-only indicators, always calculated on request from the stored data. */
export function createKpisRoutes(prisma: PrismaClient) {
  const controller = createKpisController(createKpisService(createKpisRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/portfolio", validate("query", portfolioQuery), async (c) => {
      const { body } = await controller.portfolio(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .get("/properties/:id", validate("param", propertyParam), validate("query", propertyQuery), async (c) => {
      const { body } = await controller.property(tenantScope(c), c.req.valid("param").id, c.req.valid("query"));
      return c.json(body);
    });
}
