import type { Prisma } from "../../generated/prisma/client.js";
import type { ContractStatus, ContractType, ReservationStatus, UsageType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { OccupantRef } from "../occupants/occupant-input.js";
import { createOccupantLookup, type OccupantLookup } from "../occupants/occupants.repository.js";

const select = {
  id: true,
  propertyId: true,
  contractId: true,
  checkIn: true,
  checkOut: true,
  totalAmountCents: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { name: true } },
  occupant: { select: { id: true, name: true, document: true, email: true, phone: true } },
} satisfies Prisma.ReservationSelect;

export type ReservationRecord = Prisma.ReservationGetPayload<{ select: typeof select }>;

/** Every query is bound to one organization; members only reach reservations of properties they created. */
export interface ReservationScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface NewReservationData {
  propertyId: string;
  contractId: string | null;
  checkIn: Date;
  checkOut: Date;
  totalAmountCents: bigint;
  notes: string | null;
  guest: OccupantRef;
}

export interface ReservationPatch {
  checkIn?: Date;
  checkOut?: Date;
  totalAmountCents?: bigint;
  contractId?: string | null;
  notes?: string | null;
}

export interface ReservationListQuery {
  propertyId?: string;
  contractId?: string;
  status?: ReservationStatus;
  /** Keep the reservations that overlap the window [from, to). */
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface PropertyForReservation {
  id: string;
  usageType: UsageType;
}

export interface ContractForReservation {
  id: string;
  propertyId: string;
  contractType: ContractType;
  status: ContractStatus;
  startDate: Date;
  endDate: Date | null;
}

export interface StayWindow {
  id: string;
  checkIn: Date;
  checkOut: Date;
}

export interface ReservationsRepository extends OccupantLookup {
  list(scope: ReservationScope, query: ReservationListQuery): Promise<{ items: ReservationRecord[]; total: number }>;
  findById(scope: ReservationScope, id: string): Promise<ReservationRecord | null>;
  create(scope: ReservationScope, data: NewReservationData): Promise<ReservationRecord>;
  /** Only touches a confirmed reservation. Returns null when it is missing or not confirmed. */
  update(scope: ReservationScope, id: string, patch: ReservationPatch): Promise<ReservationRecord | null>;
  /** Returns false when the reservation was not confirmed. */
  cancel(scope: ReservationScope, id: string): Promise<boolean>;

  findProperty(scope: ReservationScope, propertyId: string): Promise<PropertyForReservation | null>;
  findContract(organizationId: string, contractId: string): Promise<ContractForReservation | null>;
  /** A confirmed reservation of the property that overlaps [checkIn, checkOut). Same-day turnover does not overlap. */
  findOverlapping(
    propertyId: string,
    window: { checkIn: Date; checkOut: Date },
    excludeId?: string,
  ): Promise<StayWindow | null>;
}

function whereFor(scope: ReservationScope): Prisma.ReservationWhereInput {
  return {
    organizationId: scope.organizationId,
    ...(scope.propertyCreatedById ? { property: { createdById: scope.propertyCreatedById } } : {}),
  };
}

/**
 * The database refuses overlapping confirmed reservations (EXCLUDE constraint, SQLSTATE 23P01).
 * The service checks first for a friendly message; this covers two requests racing for the same dates.
 */
function translateWriteError(error: unknown): never {
  const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
  if (text.includes("ex_reservations_no_overlap") || text.includes("23P01")) {
    throw AppError.conflict("The property already has a confirmed reservation in these dates");
  }
  throw error;
}

/** Repository layer: the only place that talks to Prisma. */
export function createReservationsRepository(prisma: PrismaClient): ReservationsRepository {
  return {
    async list(scope, { propertyId, contractId, status, from, to, skip, take }) {
      const where: Prisma.ReservationWhereInput = {
        ...whereFor(scope),
        ...(propertyId ? { propertyId } : {}),
        ...(contractId ? { contractId } : {}),
        ...(status ? { status } : {}),
        ...(from ? { checkOut: { gt: from } } : {}),
        ...(to ? { checkIn: { lt: to } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.reservation.findMany({ where, select, orderBy: [{ checkIn: "desc" }, { id: "asc" }], skip, take }),
        prisma.reservation.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, id) {
      return prisma.reservation.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    async create(scope, data) {
      try {
        return await prisma.$transaction(async (tx) => {
          const occupantId =
            "existingId" in data.guest
              ? data.guest.existingId
              : (await tx.occupant.create({
                  data: { ...data.guest.create, organizationId: scope.organizationId },
                  select: { id: true },
                })).id;

          return tx.reservation.create({
            data: {
              organizationId: scope.organizationId,
              propertyId: data.propertyId,
              occupantId,
              // The composite FK (contract_id, property_id) makes sure the contract belongs to the same property.
              ...(data.contractId ? { contractId: data.contractId } : {}),
              checkIn: data.checkIn,
              checkOut: data.checkOut,
              totalAmountCents: data.totalAmountCents,
              notes: data.notes,
            },
            select,
          });
        });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    async update(scope, id, patch) {
      try {
        const { count } = await prisma.reservation.updateMany({
          where: { ...whereFor(scope), id, status: "confirmed" },
          data: patch,
        });
        if (count === 0) return null;
        return await prisma.reservation.findFirst({ where: { ...whereFor(scope), id }, select });
      } catch (error) {
        return translateWriteError(error);
      }
    },

    async cancel(scope, id) {
      const { count } = await prisma.reservation.updateMany({
        where: { ...whereFor(scope), id, status: "confirmed" },
        data: { status: "cancelled" },
      });
      return count > 0;
    },

    findProperty(scope, propertyId) {
      return prisma.property.findFirst({
        where: {
          id: propertyId,
          organizationId: scope.organizationId,
          ...(scope.propertyCreatedById ? { createdById: scope.propertyCreatedById } : {}),
        },
        select: { id: true, usageType: true },
      });
    },

    findContract(organizationId, contractId) {
      return prisma.contract.findFirst({
        where: { id: contractId, organizationId },
        select: { id: true, propertyId: true, contractType: true, status: true, startDate: true, endDate: true },
      });
    },

    findOverlapping(propertyId, { checkIn, checkOut }, excludeId) {
      return prisma.reservation.findFirst({
        where: {
          propertyId,
          status: "confirmed",
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, checkIn: true, checkOut: true },
      });
    },

    ...createOccupantLookup(prisma),
  };
}
