import { Prisma } from "../../generated/prisma/client.js";
import type {
  AdjustmentIndex,
  ContractStatus,
  ContractType,
  RentalMode,
  UsageType,
} from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { OccupantRef } from "../occupants/occupant-input.js";
import { createOccupantLookup, type OccupantLookup } from "../occupants/occupants.repository.js";

const select = {
  id: true,
  propertyId: true,
  contractType: true,
  status: true,
  startDate: true,
  endDate: true,
  notes: true,
  pdfFileId: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { name: true } },
  occupant: { select: { id: true, name: true, document: true, email: true, phone: true } },
  rentTerms: { select: { monthlyRentCents: true, dueDay: true, adjustmentIndex: true } },
} satisfies Prisma.ContractSelect;

export type ContractRecord = Prisma.ContractGetPayload<{ select: typeof select }>;

/** Every query is bound to one organization; members only reach contracts of properties they created. */
export interface ContractScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface RentTermsData {
  monthlyRentCents: bigint;
  dueDay: number;
  adjustmentIndex: AdjustmentIndex | null;
}

export interface NewContractData {
  propertyId: string;
  contractType: ContractType;
  startDate: Date;
  endDate: Date | null;
  notes: string | null;
  /** A conventional contract has rent terms; a short-stay one never does. */
  rentTerms: RentTermsData | null;
  occupant: OccupantRef;
}

export interface ContractPatch {
  endDate?: Date | null;
  notes?: string | null;
  rentTerms?: Partial<RentTermsData>;
}

export interface PropertyForContract {
  id: string;
  usageType: UsageType;
  rentalMode: RentalMode;
}

export interface ContractListQuery {
  propertyId?: string;
  status?: ContractStatus;
  contractType?: ContractType;
  skip: number;
  take: number;
}

export interface ContractsRepository extends OccupantLookup {
  list(scope: ContractScope, query: ContractListQuery): Promise<{ items: ContractRecord[]; total: number }>;
  findById(scope: ContractScope, id: string): Promise<ContractRecord | null>;
  /**
   * Creates the contract. If the property already has an active contract it is ended in the same
   * transaction (its end date is moved to the new start when that shortens it), so the "one active
   * contract per property" index is never violated. Returns the replaced contract id, if any.
   */
  create(
    scope: ContractScope,
    data: NewContractData,
  ): Promise<{ contract: ContractRecord; replacedContractId: string | null }>;
  update(scope: ContractScope, id: string, patch: ContractPatch): Promise<ContractRecord | null>;
  /** Moves an ACTIVE contract to a final status. Returns false when it was not active. */
  close(
    scope: ContractScope,
    id: string,
    change: { status: "ended" | "cancelled"; endDate?: Date },
  ): Promise<boolean>;

  findProperty(scope: ContractScope, propertyId: string): Promise<PropertyForContract | null>;
}

function whereFor(scope: ContractScope): Prisma.ContractWhereInput {
  return {
    organizationId: scope.organizationId,
    ...(scope.propertyCreatedById ? { property: { createdById: scope.propertyCreatedById } } : {}),
  };
}

/** `(organization_id, document)` is unique on occupants: a concurrent create with the same document loses. */
function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta ?? {});
    if (target.includes("document")) {
      throw AppError.conflict("An occupant with this document already exists", { field: "occupant.document" });
    }
    // The only other unique index a contract insert can hit: one active contract per property.
    throw AppError.conflict("The property already has an active contract");
  }
  throw error;
}

/** Repository layer: the only place that talks to Prisma. */
export function createContractsRepository(prisma: PrismaClient): ContractsRepository {
  return {
    async list(scope, { propertyId, status, contractType, skip, take }) {
      const where: Prisma.ContractWhereInput = {
        ...whereFor(scope),
        ...(propertyId ? { propertyId } : {}),
        ...(status ? { status } : {}),
        ...(contractType ? { contractType } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.contract.findMany({
          where,
          select,
          orderBy: [{ startDate: "desc" }, { id: "asc" }],
          skip,
          take,
        }),
        prisma.contract.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, id) {
      return prisma.contract.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    async create(scope, data) {
      try {
        return await prisma.$transaction(async (tx) => {
          const active = await tx.contract.findFirst({
            where: { organizationId: scope.organizationId, propertyId: data.propertyId, status: "active" },
            select: { id: true, startDate: true, endDate: true },
          });
          if (active) {
            const shorten =
              data.startDate > active.startDate && (active.endDate === null || active.endDate > data.startDate);
            await tx.contract.update({
              where: { id: active.id },
              data: { status: "ended", ...(shorten ? { endDate: data.startDate } : {}) },
            });
          }

          const occupantId =
            "existingId" in data.occupant
              ? data.occupant.existingId
              : (await tx.occupant.create({
                  data: { ...data.occupant.create, organizationId: scope.organizationId },
                  select: { id: true },
                })).id;

          const contract = await tx.contract.create({
            data: {
              organizationId: scope.organizationId,
              propertyId: data.propertyId,
              occupantId,
              contractType: data.contractType,
              startDate: data.startDate,
              endDate: data.endDate,
              notes: data.notes,
              ...(data.rentTerms ? { rentTerms: { create: data.rentTerms } } : {}),
            },
            select,
          });
          return { contract, replacedContractId: active?.id ?? null };
        });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    update(scope, id, { rentTerms, ...patch }) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.contract.updateMany({ where: { ...whereFor(scope), id }, data: patch });
        if (count === 0) return null;
        if (rentTerms && Object.keys(rentTerms).length > 0) {
          await tx.contractRentTerms.update({ where: { contractId: id }, data: rentTerms });
        }
        return tx.contract.findFirst({ where: { ...whereFor(scope), id }, select });
      });
    },

    async close(scope, id, { status, endDate }) {
      const { count } = await prisma.contract.updateMany({
        where: { ...whereFor(scope), id, status: "active" },
        data: { status, ...(endDate ? { endDate } : {}) },
      });
      return count > 0;
    },

    async findProperty(scope, propertyId) {
      return prisma.property.findFirst({
        where: {
          id: propertyId,
          organizationId: scope.organizationId,
          ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
        },
        select: { id: true, usageType: true, rentalMode: true },
      });
    },

    ...createOccupantLookup(prisma),
  };
}
