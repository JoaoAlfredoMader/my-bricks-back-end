import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { numberToCents } from "../../shared/money.js";
import { type Page, type ProposalDto, toProposalDto } from "./proposals.dto.js";
import type { ProposalData, ProposalScope, ProposalsRepository } from "./proposals.repository.js";
import type { CreateProposalInput, ListProposalsInput, UpdateProposalInput } from "./proposals.schemas.js";

export interface ProposalsService {
  list(tenant: TenantScope, propertyId: string, query: ListProposalsInput): Promise<Page<ProposalDto>>;
  get(tenant: TenantScope, propertyId: string, id: string): Promise<ProposalDto>;
  create(tenant: TenantScope, propertyId: string, input: CreateProposalInput): Promise<ProposalDto>;
  update(tenant: TenantScope, propertyId: string, id: string, input: UpdateProposalInput): Promise<ProposalDto>;
  remove(tenant: TenantScope, propertyId: string, id: string): Promise<void>;
}

/** Owners and admins see the whole organization; members only proposals of properties they created. */
function visibleScope(tenant: TenantScope): ProposalScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Service layer: business rules. No HTTP, no Prisma. */
export function createProposalsService(repository: ProposalsRepository): ProposalsService {
  /** An unknown or invisible property is a 404, not an empty list. */
  async function assertProperty(scope: ProposalScope, propertyId: string): Promise<void> {
    if (!(await repository.propertyVisible(scope, propertyId))) throw AppError.notFound("Property not found");
  }

  return {
    async list(tenant, propertyId, { page, pageSize, proposalType }) {
      const scope = visibleScope(tenant);
      await assertProperty(scope, propertyId);
      const { items, total } = await repository.list(scope, propertyId, {
        ...(proposalType ? { proposalType } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toProposalDto), page, pageSize, total };
    },

    async get(tenant, propertyId, id) {
      const proposal = await repository.findById(visibleScope(tenant), propertyId, id);
      if (!proposal) throw AppError.notFound("Proposal not found");
      return toProposalDto(proposal);
    },

    async create(tenant, propertyId, input) {
      await assertProperty(visibleScope(tenant), propertyId);
      const created = await repository.create(propertyId, {
        proposalType: input.proposalType,
        amountCents: numberToCents(input.amountCents),
        proposalDate: toDate(input.proposalDate),
        contact: input.contact ?? null,
        notes: input.notes ?? null,
      });
      return toProposalDto(created);
    },

    async update(tenant, propertyId, id, input) {
      const patch: Partial<ProposalData> = {};
      if (input.proposalType !== undefined) patch.proposalType = input.proposalType;
      if (input.amountCents !== undefined) patch.amountCents = numberToCents(input.amountCents);
      if (input.proposalDate !== undefined) patch.proposalDate = toDate(input.proposalDate);
      if (input.contact !== undefined) patch.contact = input.contact;
      if (input.notes !== undefined) patch.notes = input.notes;

      const updated = await repository.update(visibleScope(tenant), propertyId, id, patch);
      if (!updated) throw AppError.notFound("Proposal not found");
      return toProposalDto(updated);
    },

    async remove(tenant, propertyId, id) {
      if (!(await repository.delete(visibleScope(tenant), propertyId, id))) throw AppError.notFound("Proposal not found");
    },
  };
}
