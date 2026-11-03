import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { numberToCents } from "../../shared/money.js";
import { resolveOccupantRef } from "../occupants/occupant-input.js";
import { type ContractCreatedDto, type ContractDto, type Page, toContractDto } from "./contracts.dto.js";
import type {
  ContractPatch,
  ContractRecord,
  ContractScope,
  ContractsRepository,
  NewContractData,
  RentTermsData,
} from "./contracts.repository.js";
import type {
  CreateContractInput,
  EndContractInput,
  ListContractsInput,
  UpdateContractInput,
} from "./contracts.schemas.js";

export interface ContractsService {
  list(tenant: TenantScope, query: ListContractsInput): Promise<Page<ContractDto>>;
  get(tenant: TenantScope, id: string): Promise<ContractDto>;
  create(tenant: TenantScope, input: CreateContractInput): Promise<ContractCreatedDto>;
  update(tenant: TenantScope, id: string, input: UpdateContractInput): Promise<ContractDto>;
  end(tenant: TenantScope, id: string, input: EndContractInput): Promise<ContractDto>;
  cancel(tenant: TenantScope, id: string): Promise<ContractDto>;
}

/** Owners and admins see the whole organization; members only contracts of properties they created. */
function visibleScope(tenant: TenantScope): ContractScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

function assertActive(contract: ContractRecord): void {
  if (contract.status !== "active") {
    throw AppError.businessRule("Only active contracts can be changed", { status: contract.status });
  }
}

function assertEndsAfterStart(contract: ContractRecord, endDate: string): void {
  if (endDate <= toDateOnly(contract.startDate)) {
    throw AppError.validation([{ path: "endDate", message: "End date must be after the start date" }]);
  }
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createContractsService(repository: ContractsRepository): ContractsService {
  async function loadOrFail(scope: ContractScope, id: string): Promise<ContractRecord> {
    const contract = await repository.findById(scope, id);
    if (!contract) throw AppError.notFound("Contract not found");
    return contract;
  }

  async function closeAndReload(
    tenant: TenantScope,
    id: string,
    change: { status: "ended" | "cancelled"; endDate?: Date },
  ): Promise<ContractDto> {
    const scope = visibleScope(tenant);
    if (!(await repository.close(scope, id, change))) {
      throw AppError.businessRule("Only active contracts can be changed");
    }
    return toContractDto(await loadOrFail(scope, id));
  }

  return {
    async list(tenant, { page, pageSize, propertyId, status, contractType }) {
      const { items, total } = await repository.list(visibleScope(tenant), {
        ...(propertyId ? { propertyId } : {}),
        ...(status ? { status } : {}),
        ...(contractType ? { contractType } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toContractDto), page, pageSize, total };
    },

    async get(tenant, id) {
      return toContractDto(await loadOrFail(visibleScope(tenant), id));
    },

    async create(tenant, input) {
      const scope = visibleScope(tenant);

      const property = await repository.findProperty(scope, input.propertyId);
      if (!property) throw AppError.notFound("Property not found");

      // Contracts only make sense for properties that are let out, and rent follows the contract.
      if (property.usageType === "own_use" || property.usageType === "loan_for_use") {
        throw AppError.businessRule("A property for own use or loan for use cannot have contracts");
      }
      if (property.rentalMode !== "contract") {
        throw AppError.businessRule("Switch the property to contract rental mode before creating contracts");
      }
      const isShortStayProperty = property.usageType === "short_stay";
      if ((input.contractType === "short_stay") !== isShortStayProperty) {
        throw AppError.businessRule(
          isShortStayProperty
            ? "Short-stay properties only take short-stay contracts"
            : "Short-stay contracts need a property with short-stay usage",
        );
      }

      const occupant = await resolveOccupantRef(repository, tenant.organizationId, input);

      const rentTerms: RentTermsData | null = input.rentTerms
        ? {
            monthlyRentCents: numberToCents(input.rentTerms.monthlyRentCents),
            dueDay: input.rentTerms.dueDay,
            adjustmentIndex: input.rentTerms.adjustmentIndex ?? null,
          }
        : null;
      const data: NewContractData = {
        propertyId: input.propertyId,
        contractType: input.contractType,
        startDate: toDate(input.startDate),
        endDate: input.endDate ? toDate(input.endDate) : null,
        notes: input.notes ?? null,
        rentTerms,
        occupant,
      };

      const { contract, replacedContractId } = await repository.create(scope, data);
      return { ...toContractDto(contract), replacedContractId };
    },

    async update(tenant, id, input) {
      const scope = visibleScope(tenant);
      const current = await loadOrFail(scope, id);
      assertActive(current);

      const patch: ContractPatch = {};
      if (input.endDate !== undefined) {
        if (input.endDate !== null) assertEndsAfterStart(current, input.endDate);
        patch.endDate = input.endDate === null ? null : toDate(input.endDate);
      }
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.rentTerms !== undefined) {
        if (current.contractType !== "conventional") {
          throw AppError.validation([{ path: "rentTerms", message: "Short-stay contracts have no rent terms" }]);
        }
        const terms: Partial<RentTermsData> = {};
        if (input.rentTerms.monthlyRentCents !== undefined) {
          terms.monthlyRentCents = numberToCents(input.rentTerms.monthlyRentCents);
        }
        if (input.rentTerms.dueDay !== undefined) terms.dueDay = input.rentTerms.dueDay;
        if (input.rentTerms.adjustmentIndex !== undefined) terms.adjustmentIndex = input.rentTerms.adjustmentIndex;
        patch.rentTerms = terms;
      }

      const updated = await repository.update(scope, id, patch);
      if (!updated) throw AppError.notFound("Contract not found");
      return toContractDto(updated);
    },

    async end(tenant, id, { endDate }) {
      const current = await loadOrFail(visibleScope(tenant), id);
      assertActive(current);
      if (endDate) assertEndsAfterStart(current, endDate);
      return closeAndReload(tenant, id, { status: "ended", ...(endDate ? { endDate: toDate(endDate) } : {}) });
    },

    async cancel(tenant, id) {
      assertActive(await loadOrFail(visibleScope(tenant), id));
      return closeAndReload(tenant, id, { status: "cancelled" });
    },
  };
}
