import type { PrismaClient } from "../../lib/prisma.js";
import type { Auth } from "./auth.js";

export interface PlatformAdminInput {
  email: string;
  name: string;
  /** Only used when the account does not exist yet. */
  password: string | undefined;
}

export interface PlatformAdminResult {
  /** The account did not exist and was created. */
  created: boolean;
  /** The account existed without the role and was promoted. */
  promoted: boolean;
}

/**
 * Makes sure the platform operator account exists and has the `admin` role. Idempotent: running it
 * again changes nothing, and an existing account keeps its password. The role lives on `users.role`
 * (Better Auth's admin plugin); being the owner of an organization never grants it.
 */
export async function ensurePlatformAdmin(
  { auth, prisma }: { auth: Auth; prisma: PrismaClient },
  { email, name, password }: PlatformAdminInput,
): Promise<PlatformAdminResult> {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, role: true } });

  if (existing) {
    const alreadyAdmin = (existing.role ?? "").split(",").some((role) => role.trim() === "admin");
    if (alreadyAdmin) return { created: false, promoted: false };
    await prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } });
    return { created: false, promoted: true };
  }

  if (!password) throw new Error("The account does not exist yet: a password is required to create it");
  // Goes through Better Auth so the password is hashed the way sign-in expects, and the
  // account gets its personal organization like any other user.
  await auth.api.signUpEmail({ body: { name, email: normalized, password } });
  await prisma.user.update({ where: { email: normalized }, data: { role: "admin" } });
  return { created: true, promoted: false };
}
