import type { PrismaClient } from "../../lib/prisma.js";

export interface HealthRepository {
  pingDatabase(): Promise<boolean>;
}

/** Repository layer: the only place that talks to Prisma. */
export function createHealthRepository(prisma: PrismaClient): HealthRepository {
  return {
    async pingDatabase() {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}
