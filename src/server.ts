import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const app = createApp({ prisma });

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
