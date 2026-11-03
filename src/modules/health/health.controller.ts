import type { HealthReport, HealthService } from "./health.service.js";

export interface HttpResult<TBody> {
  status: 200 | 503;
  body: TBody;
}

export interface HealthController {
  check(): Promise<HttpResult<HealthReport>>;
}

/**
 * Controller layer: receives already-validated input (never the Hono Context),
 * calls the service and maps the result to a status code and DTO.
 */
export function createHealthController(service: HealthService): HealthController {
  return {
    async check() {
      const report = await service.check();
      return { status: report.status === "ok" ? 200 : 503, body: report };
    },
  };
}
