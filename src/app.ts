import { Hono } from "hono";
import { logger } from "hono/logger";
import type { PrismaClient } from "./lib/prisma.js";
import { createHealthRoutes } from "./modules/health/health.route.js";
import { AppError } from "./shared/errors/app-error.js";

export interface AppDependencies {
  prisma: PrismaClient;
}

export function createApp({ prisma }: AppDependencies) {
  const app = new Hono();

  app.use(logger());

  app.route("/health", createHealthRoutes(prisma));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status,
      );
    }
    console.error(error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected error" } },
      500,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
