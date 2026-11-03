import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createAuditRecorder } from "./modules/audit/audit.recorder.js";
import { createAuditRepository } from "./modules/audit/audit.repository.js";
import { createAuth } from "./modules/auth/auth.js";
import { createProvisioningRepository } from "./modules/auth/provisioning.repository.js";
import { createProvisioningService } from "./modules/auth/provisioning.service.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

// Composition root: dependencies are wired by hand.
const provisioning = createProvisioningService(createProvisioningRepository(prisma), {
  demoTtlHours: env.DEMO_TTL_HOURS,
});
const audit = createAuditRecorder(createAuditRepository(prisma));
const auth = createAuth({ prisma, env, provisioning, audit });
const app = createApp({ prisma, env, auth, provisioning, audit });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`MyBricks API listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
