import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { Env } from "./config/env.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { Auth } from "./modules/auth/auth.js";
import { createAuthRoutes } from "./modules/auth/auth.route.js";
import type { ProvisioningService } from "./modules/auth/provisioning.service.js";
import { createClientsRoutes } from "./modules/clients/clients.route.js";
import { createHealthRoutes } from "./modules/health/health.route.js";
import { createSessionRoutes } from "./modules/session/session.route.js";
import { AppError } from "./shared/errors/app-error.js";
import type { AppEnv } from "./shared/http/app-env.js";
import { loadAuthContext } from "./shared/http/auth.middleware.js";

export interface AppDependencies {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL">;
  auth: Auth;
  provisioning: ProvisioningService;
}

export function createApp({ prisma, env, auth, provisioning }: AppDependencies) {
  const app = new Hono<AppEnv>();

  app.use(logger());
  app.use("/api/*", cors({ origin: env.FRONTEND_URL, credentials: true }));

  app.route("/health", createHealthRoutes(prisma));

  // Better Auth answers on its own; everything else under /api gets the session context.
  app.route("/api/auth", createAuthRoutes(auth));
  app.use("/api/*", loadAuthContext(auth, provisioning));
  app.route("/api/me", createSessionRoutes());
  app.route("/api/clients", createClientsRoutes(prisma));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );

  app.onError((error, c) => {
    // Raised by Hono itself, e.g. a malformed JSON body.
    if (error instanceof HTTPException && error.status < 500) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: error.message } }, error.status);
    }
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
