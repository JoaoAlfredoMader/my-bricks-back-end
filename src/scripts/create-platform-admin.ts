import { loadEnv } from "../config/env.js";
import { createContainer } from "../container.js";
import { ensurePlatformAdmin } from "../modules/auth/platform-admin.js";

/**
 * Creates (or promotes) the platform operator.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run admin:create
 * ADMIN_NAME is optional. The password is read from the environment so it never lands in the shell
 * history or in a process list, and it is never printed.
 */
const email = process.env.ADMIN_EMAIL;
if (!email) {
  console.error("ADMIN_EMAIL is required");
  process.exit(1);
}

const { prisma, auth } = createContainer(loadEnv(), { withoutDemoData: true });
try {
  const result = await ensurePlatformAdmin(
    { auth, prisma },
    { email, name: process.env.ADMIN_NAME ?? "Administrador", password: process.env.ADMIN_PASSWORD },
  );
  console.log(
    result.created ? `Platform admin created: ${email}` : result.promoted ? `Existing account promoted to platform admin: ${email}` : `${email} is already a platform admin`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
