import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import { createHealthController } from "./health.controller.js";
import { createHealthRepository } from "./health.repository.js";
import { createHealthService } from "./health.service.js";

/**
 * Route layer: HTTP binding (path, validation, serialization).
 * Dependencies are wired by hand here (composition root of the module), no DI framework.
 */
export function createHealthRoutes(prisma: PrismaClient) {
  const controller = createHealthController(createHealthService(createHealthRepository(prisma)));

  return new Hono().get("/", async (c) => {
    const { status, body } = await controller.check();
    return c.json(body, status);
  });
}
