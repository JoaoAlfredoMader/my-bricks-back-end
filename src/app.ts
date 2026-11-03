import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { Env } from "./config/env.js";
import type { PrismaClient } from "./lib/prisma.js";
import type { StorageProvider } from "./lib/storage/storage.js";
import type { Auth } from "./modules/auth/auth.js";
import { createAgenciesRoutes } from "./modules/agencies/agencies.route.js";
import type { AuditRecorder } from "./modules/audit/audit.recorder.js";
import { createAdminAuditRoutes, createAuditRoutes } from "./modules/audit/audit.route.js";
import { createAuthRoutes } from "./modules/auth/auth.route.js";
import type { ProvisioningService } from "./modules/auth/provisioning.service.js";
import { createClientsRoutes } from "./modules/clients/clients.route.js";
import { createContractDocumentsRoutes } from "./modules/contract-documents/contract-documents.route.js";
import { createContractTemplatesRoutes } from "./modules/contract-templates/contract-templates.route.js";
import { createContractsRoutes } from "./modules/contracts/contracts.route.js";
import { createDocumentsRoutes } from "./modules/documents/documents.route.js";
import { createAdminFeedbackRoutes, createFeedbackRoutes } from "./modules/feedback/feedback.route.js";
import { createHealthRoutes } from "./modules/health/health.route.js";
import { createKpisRoutes } from "./modules/kpis/kpis.route.js";
import { createLookupsRoutes } from "./modules/lookups/lookups.route.js";
import { createOccupantsRoutes } from "./modules/occupants/occupants.route.js";
import { createPhotosRoutes } from "./modules/photos/photos.route.js";
import { createPropertiesRoutes } from "./modules/properties/properties.route.js";
import { createProposalsRoutes } from "./modules/proposals/proposals.route.js";
import { createReservationsRoutes } from "./modules/reservations/reservations.route.js";
import { createSessionRoutes } from "./modules/session/session.route.js";
import { createTransactionsRoutes } from "./modules/transactions/transactions.route.js";
import { AppError } from "./shared/errors/app-error.js";
import type { AppEnv } from "./shared/http/app-env.js";
import { blockDeletesWhileImpersonating, loadAuthContext } from "./shared/http/auth.middleware.js";

export interface AppDependencies {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL"> & Partial<Pick<Env, "NODE_ENV" | "MAX_UPLOAD_MB">>;
  auth: Auth;
  provisioning: ProvisioningService;
  audit: AuditRecorder;
  /** Where uploaded files go (photos, documents). */
  storage: StorageProvider;
}

export function createApp({ prisma, env, auth, provisioning, audit, storage }: AppDependencies) {
  const maxUploadBytes = (env.MAX_UPLOAD_MB ?? 15) * 1024 * 1024;
  const app = new Hono<AppEnv>();

  // Request logs would drown the test output.
  if (env.NODE_ENV !== "test") app.use(logger());
  app.use("/api/*", cors({ origin: env.FRONTEND_URL, credentials: true }));

  app.route("/health", createHealthRoutes(prisma));

  // Better Auth answers on its own; everything else under /api gets the session context.
  app.route("/api/auth", createAuthRoutes(auth));
  app.use("/api/*", loadAuthContext(auth, provisioning));
  app.use("/api/*", blockDeletesWhileImpersonating);
  app.use("/api/*", async (c, next) => {
    c.set("audit", audit);
    await next();
  });
  app.route("/api/me", createSessionRoutes());
  app.route("/api/admin/audit-logs", createAdminAuditRoutes(prisma));
  app.route("/api/admin/feedback", createAdminFeedbackRoutes(prisma));
  app.route("/api/audit-logs", createAuditRoutes(prisma));
  app.route("/api/agencies", createAgenciesRoutes(prisma));
  app.route("/api/clients", createClientsRoutes(prisma));
  app.route("/api/contract-template", createContractTemplatesRoutes(prisma));
  app.route("/api/contracts/:id/pdf", createContractDocumentsRoutes(prisma, storage));
  app.route("/api/contracts", createContractsRoutes(prisma));
  app.route("/api/feedback", createFeedbackRoutes(prisma));
  app.route("/api/kpis", createKpisRoutes(prisma));
  app.route("/api/lookups", createLookupsRoutes(prisma));
  app.route("/api/properties", createPropertiesRoutes(prisma));
  app.route("/api/properties/:propertyId/documents", createDocumentsRoutes(prisma, storage, maxUploadBytes));
  app.route("/api/properties/:propertyId/photos", createPhotosRoutes(prisma, storage, maxUploadBytes));
  app.route("/api/properties/:propertyId/proposals", createProposalsRoutes(prisma));
  app.route("/api/occupants", createOccupantsRoutes(prisma));
  app.route("/api/reservations", createReservationsRoutes(prisma));
  app.route("/api/transactions", createTransactionsRoutes(prisma));

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
