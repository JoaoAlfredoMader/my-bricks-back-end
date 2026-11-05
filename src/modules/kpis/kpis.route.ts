import { Hono } from "hono";
import { z } from "zod";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { MAX_CASH_FLOW_MONTHS, countMonths } from "./kpi-calculations.js";
import { createKpisController } from "./kpis.controller.js";
import { createKpisRepository } from "./kpis.repository.js";
import { createKpisService } from "./kpis.service.js";

/** Calculate as of this date (`YYYY-MM-DD`); defaults to today. */
const asOf = z.iso.date().optional();

export const portfolioQuerySchema = z.object({ asOf, clientId: z.uuid().optional() });
export const propertyKpisQuerySchema = z.object({ asOf });
export const propertyKpisParamSchema = z.object({ id: z.uuid() });

const month = z.string().regex(/^[12]\d{3}-(0[1-9]|1[0-2])$/, "Use a month as YYYY-MM");

export const cashFlowQuerySchema = z
  .object({
    from: month.describe("First month of the window (YYYY-MM)"),
    to: month.describe(`Last month of the window (YYYY-MM), included. The window has at most ${MAX_CASH_FLOW_MONTHS} months`),
    propertyId: z
      .uuid()
      .optional()
      .describe(
        "Only this property, as a whole (not weighted by ownership share). Without it: the whole portfolio the caller can see, weighted by ownership share",
      ),
  })
  .superRefine((query, context) => {
    // Without a valid month on both ends there is nothing to compare; the format errors are reported already.
    if (!month.safeParse(query.from).success || !month.safeParse(query.to).success) return;
    const months = countMonths(query.from, query.to);
    if (months < 1) context.addIssue({ code: "custom", path: ["to"], message: "`to` cannot be before `from`" });
    else if (months > MAX_CASH_FLOW_MONTHS) {
      context.addIssue({ code: "custom", path: ["to"], message: `The window has at most ${MAX_CASH_FLOW_MONTHS} months` });
    }
  });

/** Route layer: read-only indicators, always calculated on request from the stored data. */
export function createKpisRoutes(prisma: PrismaClient) {
  const controller = createKpisController(createKpisService(createKpisRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/portfolio", validate("query", portfolioQuerySchema), async (c) => {
      const { body } = await controller.portfolio(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .get("/cash-flow", validate("query", cashFlowQuerySchema), async (c) => {
      const { body } = await controller.cashFlow(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .get("/properties/:id", validate("param", propertyKpisParamSchema), validate("query", propertyKpisQuerySchema), async (c) => {
      const { body } = await controller.property(tenantScope(c), c.req.valid("param").id, c.req.valid("query"));
      return c.json(body);
    });
}
