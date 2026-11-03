import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { audited } from "../../shared/http/audit.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createReservationsController } from "./reservations.controller.js";
import { createReservationsRepository } from "./reservations.repository.js";
import {
  createReservationSchema,
  listReservationsQuerySchema,
  reservationIdParamSchema,
  updateReservationSchema,
} from "./reservations.schemas.js";
import { createReservationsService } from "./reservations.service.js";

/**
 * Route layer: HTTP binding (path, validation, serialization).
 * Reservations are never deleted: they are cancelled, so the history stays.
 */
export function createReservationsRoutes(prisma: PrismaClient) {
  const controller = createReservationsController(createReservationsService(createReservationsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("query", listReservationsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("query"));
      return c.json(body);
    })
    .post("/", audited("create", "reservation"), validate("json", createReservationSchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", reservationIdParamSchema), async (c) => {
      const { body } = await controller.get(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    })
    .patch("/:id", audited("update", "reservation"), validate("param", reservationIdParamSchema), validate("json", updateReservationSchema), async (c) => {
      const { body } = await controller.update(tenantScope(c), c.req.valid("param").id, c.req.valid("json"));
      return c.json(body);
    })
    .post("/:id/cancel", audited("cancel", "reservation"), validate("param", reservationIdParamSchema), async (c) => {
      const { body } = await controller.cancel(tenantScope(c), c.req.valid("param").id);
      return c.json(body);
    });
}
