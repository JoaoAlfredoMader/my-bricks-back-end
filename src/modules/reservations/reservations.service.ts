import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { numberToCents } from "../../shared/money.js";
import { resolveOccupantRef } from "../occupants/occupant-input.js";
import { type Page, type ReservationDto, toReservationDto } from "./reservations.dto.js";
import type {
  ContractForReservation,
  ReservationPatch,
  ReservationRecord,
  ReservationScope,
  ReservationsRepository,
} from "./reservations.repository.js";
import type {
  CreateReservationInput,
  ListReservationsInput,
  UpdateReservationInput,
} from "./reservations.schemas.js";

export interface ReservationsService {
  list(tenant: TenantScope, query: ListReservationsInput): Promise<Page<ReservationDto>>;
  get(tenant: TenantScope, id: string): Promise<ReservationDto>;
  create(tenant: TenantScope, input: CreateReservationInput): Promise<ReservationDto>;
  update(tenant: TenantScope, id: string, input: UpdateReservationInput): Promise<ReservationDto>;
  cancel(tenant: TenantScope, id: string): Promise<ReservationDto>;
}

/** Owners and admins see the whole organization; members only reservations of properties they created. */
function visibleScope(tenant: TenantScope): ReservationScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** The optional contract must be an active short-stay contract of this property that covers the stay. */
function assertContractCoversStay(
  contract: ContractForReservation | null,
  propertyId: string,
  stay: { checkIn: string; checkOut: string },
): void {
  if (!contract) throw AppError.validation([{ path: "contractId", message: "Contract not found" }]);
  if (contract.propertyId !== propertyId) {
    throw AppError.validation([{ path: "contractId", message: "The contract belongs to another property" }]);
  }
  if (contract.contractType !== "short_stay") {
    throw AppError.businessRule("Only short-stay contracts can be linked to a reservation");
  }
  if (contract.status !== "active") throw AppError.businessRule("The contract is not active");

  const start = toDateOnly(contract.startDate);
  const end = contract.endDate ? toDateOnly(contract.endDate) : null;
  if (stay.checkIn < start || (end !== null && stay.checkOut > end)) {
    throw AppError.businessRule("The stay falls outside the contract period", { contractStart: start, contractEnd: end });
  }
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createReservationsService(repository: ReservationsRepository): ReservationsService {
  async function loadOrFail(scope: ReservationScope, id: string): Promise<ReservationRecord> {
    const reservation = await repository.findById(scope, id);
    if (!reservation) throw AppError.notFound("Reservation not found");
    return reservation;
  }

  async function assertNoOverlap(
    propertyId: string,
    stay: { checkIn: string; checkOut: string },
    excludeId?: string,
  ): Promise<void> {
    const clash = await repository.findOverlapping(
      propertyId,
      { checkIn: toDate(stay.checkIn), checkOut: toDate(stay.checkOut) },
      excludeId,
    );
    if (clash) {
      throw AppError.conflict("The property already has a confirmed reservation in these dates", {
        reservationId: clash.id,
        checkIn: toDateOnly(clash.checkIn),
        checkOut: toDateOnly(clash.checkOut),
      });
    }
  }

  return {
    async list(tenant, { page, pageSize, propertyId, contractId, status, from, to }) {
      const { items, total } = await repository.list(visibleScope(tenant), {
        ...(propertyId ? { propertyId } : {}),
        ...(contractId ? { contractId } : {}),
        ...(status ? { status } : {}),
        ...(from ? { from: toDate(from) } : {}),
        ...(to ? { to: toDate(to) } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toReservationDto), page, pageSize, total };
    },

    async get(tenant, id) {
      return toReservationDto(await loadOrFail(visibleScope(tenant), id));
    },

    async create(tenant, input) {
      const scope = visibleScope(tenant);

      const property = await repository.findProperty(scope, input.propertyId);
      if (!property) throw AppError.notFound("Property not found");
      if (property.usageType !== "short_stay") {
        throw AppError.businessRule("Reservations are only for properties with short-stay usage");
      }

      const stay = { checkIn: input.checkIn, checkOut: input.checkOut };
      if (input.contractId) {
        assertContractCoversStay(await repository.findContract(tenant.organizationId, input.contractId), input.propertyId, stay);
      }
      await assertNoOverlap(input.propertyId, stay);

      const guest = await resolveOccupantRef(repository, tenant.organizationId, input);
      const created = await repository.create(scope, {
        propertyId: input.propertyId,
        contractId: input.contractId ?? null,
        checkIn: toDate(input.checkIn),
        checkOut: toDate(input.checkOut),
        totalAmountCents: numberToCents(input.totalAmountCents),
        notes: input.notes ?? null,
        guest,
      });
      return toReservationDto(created);
    },

    async update(tenant, id, input) {
      const scope = visibleScope(tenant);
      const current = await loadOrFail(scope, id);
      if (current.status !== "confirmed") {
        throw AppError.businessRule("Only confirmed reservations can be changed", { status: current.status });
      }

      const stay = {
        checkIn: input.checkIn ?? toDateOnly(current.checkIn),
        checkOut: input.checkOut ?? toDateOnly(current.checkOut),
      };
      if (stay.checkOut <= stay.checkIn) {
        throw AppError.validation([{ path: "checkOut", message: "Check-out must be after check-in" }]);
      }

      const datesChanged = input.checkIn !== undefined || input.checkOut !== undefined;
      const contractId = input.contractId !== undefined ? input.contractId : current.contractId;
      if (contractId && (datesChanged || input.contractId !== undefined)) {
        assertContractCoversStay(await repository.findContract(tenant.organizationId, contractId), current.propertyId, stay);
      }
      if (datesChanged) await assertNoOverlap(current.propertyId, stay, id);

      const patch: ReservationPatch = {};
      if (input.checkIn !== undefined) patch.checkIn = toDate(input.checkIn);
      if (input.checkOut !== undefined) patch.checkOut = toDate(input.checkOut);
      if (input.totalAmountCents !== undefined) patch.totalAmountCents = numberToCents(input.totalAmountCents);
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.contractId !== undefined) patch.contractId = input.contractId;

      const updated = await repository.update(scope, id, patch);
      if (!updated) throw AppError.businessRule("Only confirmed reservations can be changed");
      return toReservationDto(updated);
    },

    async cancel(tenant, id) {
      const scope = visibleScope(tenant);
      const current = await loadOrFail(scope, id);
      if (current.status !== "confirmed" || !(await repository.cancel(scope, id))) {
        throw AppError.businessRule("Only confirmed reservations can be cancelled", { status: current.status });
      }
      return toReservationDto(await loadOrFail(scope, id));
    },
  };
}
