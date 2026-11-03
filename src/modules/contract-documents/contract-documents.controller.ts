import type { TenantScope } from "../../shared/http/tenant.js";
import type { ContractDocumentsService, ContractPdfDto, ContractPdfFile } from "./contract-documents.service.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface ContractDocumentsController {
  generate(tenant: TenantScope, contractId: string): Promise<HttpResult<ContractPdfDto>>;
  download(tenant: TenantScope, contractId: string): Promise<HttpResult<ContractPdfFile>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createContractDocumentsController(service: ContractDocumentsService): ContractDocumentsController {
  return {
    async generate(tenant, contractId) {
      return { status: 200, body: await service.generate(tenant, contractId) };
    },
    async download(tenant, contractId) {
      return { status: 200, body: await service.download(tenant, contractId) };
    },
  };
}
