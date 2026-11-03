import type { MiddlewareHandler } from "hono";
import type { Auth } from "../../modules/auth/auth.js";
import type { ProvisioningService } from "../../modules/auth/provisioning.service.js";
import { AppError } from "../errors/app-error.js";
import type { AppEnv, AuthContext } from "./app-env.js";

/**
 * Resolves the Better Auth session (cookie) into an AuthContext available as `c.var.auth`.
 * Anonymous requests continue with `auth = null`; use `requireAuth` to reject them.
 */
export function loadAuthContext(auth: Auth, provisioning: ProvisioningService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) {
      c.set("auth", null);
      return next();
    }

    const { user, session } = result;
    const organizationId =
      (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    const memberRole = organizationId ? await provisioning.memberRole(organizationId, user.id) : null;

    const context: AuthContext = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isAnonymous: Boolean((user as { isAnonymous?: boolean | null }).isAnonymous),
        platformRole: (user as { role?: string | null }).role ?? "user",
      },
      sessionId: session.id,
      organizationId,
      memberRole,
    };
    c.set("auth", context);
    return next();
  };
}

/** Rejects requests without a valid session. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("auth")) throw AppError.unauthenticated();
  return next();
};
