import type { MiddlewareHandler } from "hono";
import type { AuditAction, AuditEntityType } from "../../generated/prisma/enums.js";
import { clientIp } from "../../modules/audit/audit.recorder.js";
import type { AppEnv } from "./app-env.js";

export interface AuditedOptions {
  /** A platform-level event (not tied to the organization the operator happens to be in). */
  platformLevel?: boolean;
}

/**
 * Route-level audit: after a request succeeds (2xx) it leaves a trace of who did what to which
 * record. Put it first in the route chain. The record id is the `:id` of the path or, for a
 * creation, the `id` of the response body.
 */
export function audited(
  action: AuditAction,
  entityType: AuditEntityType,
  options: AuditedOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    const auth = c.get("auth");
    if (!auth || c.res.status < 200 || c.res.status >= 300) return;

    let entityId: string | null = c.req.param("id") ?? null;
    if (!entityId) {
      try {
        const body: unknown = await c.res.clone().json();
        const id = (body as { id?: unknown } | null)?.id;
        if (typeof id === "string") entityId = id;
      } catch {
        /* no JSON body: nothing to read */
      }
    }

    await c.get("audit").record({
      action,
      entityType,
      entityId,
      details: JSON.stringify({ method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status }),
      organizationId: options.platformLevel ? null : auth.organizationId,
      actor: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.memberRole },
      impersonatedById: auth.impersonatedById,
      ipAddress: clientIp(c.req.raw.headers),
      userAgent: c.req.header("user-agent") ?? null,
    });
  };
}
