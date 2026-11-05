import type { TenantScope } from "../../shared/http/tenant.js";
import type { CashFlowDto, PortfolioKpisDto, PropertyKpisDto } from "./kpis.dto.js";
import type { CashFlowInput, KpisService } from "./kpis.service.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface KpisController {
  property(tenant: TenantScope, id: string, options: { asOf?: string | undefined }): Promise<HttpResult<PropertyKpisDto>>;
  portfolio(
    tenant: TenantScope,
    options: { asOf?: string | undefined; clientId?: string | undefined },
  ): Promise<HttpResult<PortfolioKpisDto>>;
  cashFlow(tenant: TenantScope, input: CashFlowInput): Promise<HttpResult<CashFlowDto>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createKpisController(service: KpisService): KpisController {
  return {
    async property(tenant, id, options) {
      return { status: 200, body: await service.property(tenant, id, options) };
    },
    async portfolio(tenant, options) {
      return { status: 200, body: await service.portfolio(tenant, options) };
    },
    async cashFlow(tenant, input) {
      return { status: 200, body: await service.cashFlow(tenant, input) };
    },
  };
}
