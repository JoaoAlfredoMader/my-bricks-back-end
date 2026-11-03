import type { HealthRepository } from "./health.repository.js";

export interface HealthReport {
  status: "ok" | "degraded";
  database: "up" | "down";
  uptimeSeconds: number;
}

export interface HealthService {
  check(): Promise<HealthReport>;
}

/** Service layer: business rules (here: what "healthy" means). No HTTP, no Prisma. */
export function createHealthService(repository: HealthRepository): HealthService {
  return {
    async check() {
      const databaseUp = await repository.pingDatabase();
      return {
        status: databaseUp ? "ok" : "degraded",
        database: databaseUp ? "up" : "down",
        uptimeSeconds: Math.round(process.uptime()),
      };
    },
  };
}
