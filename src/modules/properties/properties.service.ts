import type { PropertyType, RentalMode, UsageType } from "../../generated/prisma/enums.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { numberToCents } from "../../shared/money.js";
import { type Page, type PropertyDto, toPropertyDto } from "./properties.dto.js";
import type {
  AcquisitionData,
  AddressData,
  ManualRentalData,
  PropertiesRepository,
  PropertyChildren,
  PropertyData,
  PropertyScope,
} from "./properties.repository.js";
import type {
  CreatePropertyInput,
  ListPropertiesInput,
  UpdatePropertyInput,
} from "./properties.schemas.js";

export interface PropertiesService {
  list(tenant: TenantScope, query: ListPropertiesInput): Promise<Page<PropertyDto>>;
  get(tenant: TenantScope, id: string): Promise<PropertyDto>;
  create(tenant: TenantScope, input: CreatePropertyInput): Promise<PropertyDto>;
  update(tenant: TenantScope, id: string, input: UpdatePropertyInput): Promise<PropertyDto>;
  remove(tenant: TenantScope, id: string): Promise<void>;
}

type FieldError = { path: string; message: string };

/** Owners and admins see the whole organization; members only the properties they created. */
function visibleScope(tenant: TenantScope): PropertyScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { createdById: tenant.userId }),
  };
}

function toAddressData(input: NonNullable<CreatePropertyInput["address"]>): AddressData {
  return {
    cityId: input.cityId,
    postalCode: input.postalCode ?? null,
    street: input.street,
    number: input.number ?? null,
    complement: input.complement ?? null,
    neighborhood: input.neighborhood ?? null,
  };
}

function toAcquisitionData(input: NonNullable<CreatePropertyInput["acquisition"]>): AcquisitionData {
  return {
    acquisitionType: input.acquisitionType,
    acquiredOn: input.acquiredOn ? new Date(`${input.acquiredOn}T00:00:00.000Z`) : null,
    costCents: input.costCents == null ? null : numberToCents(input.costCents),
  };
}

function toManualRentalData(input: NonNullable<CreatePropertyInput["manualRental"]>): ManualRentalData {
  return {
    tenantName: input.tenantName ?? null,
    monthlyRentCents: numberToCents(input.monthlyRentCents),
    dueDay: input.dueDay ?? null,
  };
}

interface RuleSubject {
  propertyType: PropertyType;
  usageType: UsageType;
  subtypeId: number | null;
  parkingSpotLabel: string | null;
  rentalMode: RentalMode;
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createPropertiesService(repository: PropertiesRepository): PropertiesService {
  /** Rules that span several fields, checked against the state the property will have after the write. */
  async function checkConsistency(subject: RuleSubject, hasManualRental: boolean): Promise<FieldError[]> {
    const errors: FieldError[] = [];

    if (!(await repository.isUsageAllowed(subject.propertyType, subject.usageType))) {
      errors.push({ path: "usageType", message: "This usage is not allowed for the property type" });
    }
    if (subject.subtypeId !== null && !(await repository.subtypeBelongsTo(subject.subtypeId, subject.propertyType))) {
      errors.push({ path: "subtypeId", message: "This subtype does not belong to the property type" });
    }
    if (subject.parkingSpotLabel !== null && subject.propertyType !== "parking") {
      errors.push({ path: "parkingSpotLabel", message: "Only parking properties have a parking spot label" });
    }
    if (subject.rentalMode === "contract" && hasManualRental) {
      errors.push({ path: "manualRental", message: "Manual rental data is only used in manual rental mode" });
    }
    return errors;
  }

  async function checkReferences(
    scope: PropertyScope,
    refs: { clientId?: string | null; agencyId?: string | null; cityId?: number },
  ): Promise<FieldError[]> {
    const errors: FieldError[] = [];
    if (refs.agencyId && !(await repository.agencyExists(scope.organizationId, refs.agencyId))) {
      errors.push({ path: "agencyId", message: "Agency not found" });
    }
    if (refs.clientId && !(await repository.clientVisible(scope, refs.clientId))) {
      errors.push({ path: "clientId", message: "Client not found" });
    }
    if (refs.cityId !== undefined && !(await repository.cityExists(refs.cityId))) {
      errors.push({ path: "address.cityId", message: "City not found" });
    }
    return errors;
  }

  function assertNoErrors(errors: FieldError[]): void {
    if (errors.length > 0) throw AppError.validation(errors);
  }

  return {
    async list(tenant, { page, pageSize, search, propertyType, usageType, clientId }) {
      const { items, total } = await repository.list(visibleScope(tenant), {
        ...(search ? { search } : {}),
        ...(propertyType ? { propertyType } : {}),
        ...(usageType ? { usageType } : {}),
        ...(clientId ? { clientId } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toPropertyDto), page, pageSize, total };
    },

    async get(tenant, id) {
      const property = await repository.findById(visibleScope(tenant), id);
      if (!property) throw AppError.notFound("Property not found");
      return toPropertyDto(property);
    },

    async create(tenant, input) {
      const scope = visibleScope(tenant);
      const data: PropertyData = {
        name: input.name,
        propertyType: input.propertyType,
        subtypeId: input.subtypeId ?? null,
        usageType: input.usageType,
        ownershipPercentage: input.ownershipPercentage,
        totalArea: input.totalArea ?? null,
        privateArea: input.privateArea ?? null,
        bedrooms: input.bedrooms ?? null,
        suites: input.suites ?? null,
        bathrooms: input.bathrooms ?? null,
        parkingSpaces: input.parkingSpaces ?? null,
        parkingSpotLabel: input.parkingSpotLabel ?? null,
        builtYear: input.builtYear ?? null,
        conservationState: input.conservationState ?? null,
        estimatedValueCents: input.estimatedValueCents == null ? null : numberToCents(input.estimatedValueCents),
        annualExpensesCents: numberToCents(input.annualExpensesCents),
        occupancyRate: input.occupancyRate,
        rentalMode: input.rentalMode,
        notes: input.notes ?? null,
        clientId: input.clientId ?? null,
        agencyId: input.agencyId ?? null,
      };

      assertNoErrors([
        ...(await checkConsistency(data, Boolean(input.manualRental))),
        ...(await checkReferences(scope, {
          clientId: data.clientId,
          agencyId: data.agencyId,
          ...(input.address ? { cityId: input.address.cityId } : {}),
        })),
      ]);

      const children: PropertyChildren = {
        address: input.address ? toAddressData(input.address) : null,
        manualRental: input.manualRental ? toManualRentalData(input.manualRental) : null,
        acquisition: input.acquisition ? toAcquisitionData(input.acquisition) : null,
      };
      const created = await repository.create(
        { organizationId: tenant.organizationId, createdById: tenant.userId },
        data,
        children,
      );
      return toPropertyDto(created);
    },

    async update(tenant, id, input) {
      const scope = visibleScope(tenant);
      const current = await repository.findById(scope, id);
      if (!current) throw AppError.notFound("Property not found");

      const { address, manualRental, acquisition, estimatedValueCents, annualExpensesCents, ...scalars } = input;
      const patch: Partial<PropertyData> = {};
      // Zod already validated each value; `undefined` means "not sent", `null` means "clear".
      for (const [key, value] of Object.entries(scalars)) {
        if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
      }
      if (estimatedValueCents !== undefined) {
        patch.estimatedValueCents = estimatedValueCents === null ? null : numberToCents(estimatedValueCents);
      }
      if (annualExpensesCents !== undefined) patch.annualExpensesCents = numberToCents(annualExpensesCents);

      const rentalMode = patch.rentalMode ?? current.rentalMode;
      assertNoErrors([
        ...(await checkConsistency(
          {
            propertyType: patch.propertyType ?? current.propertyType,
            usageType: patch.usageType ?? current.usageType,
            subtypeId: patch.subtypeId !== undefined ? patch.subtypeId : current.subtypeId,
            parkingSpotLabel:
              patch.parkingSpotLabel !== undefined ? patch.parkingSpotLabel : current.parkingSpotLabel,
            rentalMode,
          },
          Boolean(manualRental),
        )),
        ...(await checkReferences(scope, {
          ...(patch.clientId ? { clientId: patch.clientId } : {}),
          ...(patch.agencyId ? { agencyId: patch.agencyId } : {}),
          ...(address ? { cityId: address.cityId } : {}),
        })),
      ]);

      const children: PropertyChildren = {
        ...(address !== undefined ? { address: address ? toAddressData(address) : null } : {}),
        ...(manualRental !== undefined ? { manualRental: manualRental ? toManualRentalData(manualRental) : null } : {}),
        ...(acquisition !== undefined ? { acquisition: acquisition ? toAcquisitionData(acquisition) : null } : {}),
      };
      const updated = await repository.update(scope, id, patch, children);
      if (!updated) throw AppError.notFound("Property not found");
      return toPropertyDto(updated);
    },

    async remove(tenant, id) {
      const deleted = await repository.delete(visibleScope(tenant), id);
      if (!deleted) throw AppError.notFound("Property not found");
    },
  };
}
