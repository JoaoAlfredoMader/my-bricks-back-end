import { Hono } from "hono";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";

/** GET /api/me: who am I and in which organization am I working. */
export function createSessionRoutes() {
  return new Hono<AppEnv>().get("/", requireAuth, (c) => c.json(c.get("auth")));
}
