import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createPropertiesController } from "./properties.controller.js";
import { createPropertiesRepository } from "./properties.repository.js";
import {
  createPropertySchema,
  financingScheduleQuerySchema,
  listPropertiesQuerySchema,
  propertyIdParamSchema,
  updatePropertySchema,
} from "./properties.schemas.js";
import { createPropertiesService } from "./properties.service.js";

/** Route layer: HTTP binding (path, validation, serialization). */
export function createPropertiesRoutes(prisma: PrismaClient) {
  const controller = createPropertiesController(createPropertiesService(createPropertiesRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listPropertiesQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", audited("create", "property"), validate("json", createPropertySchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", propertyIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", audited("update", "property"), validate("param", propertyIdParamSchema), validate("json", updatePropertySchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .get("/:id/financing-schedule", validate("param", propertyIdParamSchema), validate("query", financingScheduleQuerySchema), async (c) => {
      const { body } = await controller.financingSchedule(tenantScope(c), c.req.valid("param").id, c.req.valid("query"));
      return c.json(body);
    })
    .delete("/:id", audited("delete", "property"), validate("param", propertyIdParamSchema), async (c) => {
      await controller.remove(tenantScope(c), c.req.valid("param").id);
      return c.body(null, 204);
    });
}
