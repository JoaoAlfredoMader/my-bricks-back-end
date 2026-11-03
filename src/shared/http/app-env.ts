/** Who is calling and in which organization (tenant) they are working. */
export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    isAnonymous: boolean;
    /** Platform-level role from the admin plugin (comma-separated when several). */
    platformRole: string;
  };
  sessionId: string;
  organizationId: string | null;
  /** Role of the user inside the active organization (owner | admin | member, may be comma-separated). */
  memberRole: string | null;
}

/** Hono environment shared by every route. */
export interface AppEnv {
  Variables: {
    auth: AuthContext | null;
  };
}
