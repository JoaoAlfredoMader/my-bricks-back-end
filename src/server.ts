import { serve } from "@hono/node-server";
import { loadEnv } from "./config/env.js";
import { createContainer } from "./container.js";
import { startMaintenanceJob } from "./modules/maintenance/maintenance.js";

const env = loadEnv();
const { app, prisma, storage } = createContainer(env);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`MyBricks API listening on http://localhost:${info.port}`);
});

// Expired demos, orphan files, audit retention and stale sessions.
const stopMaintenance =
  env.MAINTENANCE_INTERVAL_MINUTES > 0
    ? startMaintenanceJob({ prisma, storage, intervalMinutes: env.MAINTENANCE_INTERVAL_MINUTES })
    : () => {};

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopMaintenance();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
