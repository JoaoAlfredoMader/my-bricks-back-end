import { Hono } from "hono";
import type { Auth } from "./auth.js";

/** Mounts every Better Auth endpoint (sign-up, sign-in, organization, admin, ...) under the parent path. */
export function createAuthRoutes(auth: Auth) {
  return new Hono().on(["GET", "POST"], "/*", (c) => auth.handler(c.req.raw));
}
