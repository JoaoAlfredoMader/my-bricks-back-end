import type { Context } from "hono";
import { AppError } from "../errors/app-error.js";
import type { AppEnv } from "./app-env.js";

/** The caller and the organization (tenant) every query must be scoped to. */
export interface TenantScope {
  organizationId: string;
  userId: string;
  /** Owners and admins see every record of the organization; members only their own. */
  canSeeAll: boolean;
}

const FULL_ACCESS_ROLES = ["owner", "admin"];

/**
 * Builds the tenant scope from the session. The organization always comes from the session,
 * never from the request, so a client cannot reach another tenant by sending an id.
 */
export function tenantScope(c: Context<AppEnv>): TenantScope {
  const auth = c.get("auth");
  if (!auth) throw AppError.unauthenticated();
  if (!auth.organizationId) throw AppError.forbidden("No active organization");

  // The organization plugin may store several roles in one comma-separated string.
  const roles = (auth.memberRole ?? "").split(",").map((role) => role.trim());
  return {
    organizationId: auth.organizationId,
    userId: auth.user.id,
    canSeeAll: roles.some((role) => FULL_ACCESS_ROLES.includes(role)),
  };
}
