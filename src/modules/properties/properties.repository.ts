import type { Prisma } from "../../generated/prisma/client.js";
import type {
  AcquisitionType,
  ConservationState,
  PropertyType,
  RentalMode,
  UsageType,
} from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  createdById: true,
  clientId: true,
  name: true,
  propertyType: true,
  subtypeId: true,
  usageType: true,
  ownershipPercentage: true,
  totalArea: true,
  privateArea: true,
  bedrooms: true,
  suites: true,
  bathrooms: true,
  parkingSpaces: true,
  parkingSpotLabel: true,
  builtYear: true,
  conservationState: true,
  estimatedValueCents: true,
  annualExpensesCents: true,
  occupancyRate: true,
  rentalMode: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  address: {
    select: {
      cityId: true,
      postalCode: true,
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      latitude: true,
      longitude: true,
      city: { select: { name: true, state: true } },
    },
  },
  manualRental: { select: { tenantName: true, monthlyRentCents: true, dueDay: true } },
  acquisition: { select: { acquisitionType: true, acquiredOn: true, costCents: true } },
  /** Only used to derive the status. */
  contracts: { where: { status: "active" }, select: { id: true }, take: 1 },
} satisfies Prisma.PropertySelect;

export type PropertyRecord = Prisma.PropertyGetPayload<{ select: typeof select }>;

/** Every query is bound to one organization; members are further limited to what they created. */
export interface PropertyScope {
  organizationId: string;
  createdById?: string;
}

export interface PropertyData {
  name: string;
  propertyType: PropertyType;
  subtypeId: number | null;
  usageType: UsageType;
  ownershipPercentage: number;
  totalArea: number | null;
  privateArea: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  parkingSpotLabel: string | null;
  builtYear: number | null;
  conservationState: ConservationState | null;
  estimatedValueCents: bigint | null;
  annualExpensesCents: bigint;
  occupancyRate: number;
  rentalMode: RentalMode;
  notes: string | null;
  clientId: string | null;
}

export interface AddressData {
  cityId: number;
  postalCode: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
}

export interface ManualRentalData {
  tenantName: string | null;
  monthlyRentCents: bigint;
  dueDay: number | null;
}

export interface AcquisitionData {
  acquisitionType: AcquisitionType;
  acquiredOn: Date | null;
  costCents: bigint | null;
}

/** `undefined` leaves the child untouched, `null` removes it, a value creates or replaces it. */
export interface PropertyChildren {
  address?: AddressData | null;
  manualRental?: ManualRentalData | null;
  acquisition?: AcquisitionData | null;
}

export interface PropertyListQuery {
  search?: string;
  propertyType?: PropertyType;
  usageType?: UsageType;
  clientId?: string;
  skip: number;
  take: number;
}

export interface PropertiesRepository {
  list(scope: PropertyScope, query: PropertyListQuery): Promise<{ items: PropertyRecord[]; total: number }>;
  findById(scope: PropertyScope, id: string): Promise<PropertyRecord | null>;
  create(
    scope: PropertyScope & { createdById: string },
    data: PropertyData,
    children: PropertyChildren,
  ): Promise<PropertyRecord>;
  update(
    scope: PropertyScope,
    id: string,
    data: Partial<PropertyData>,
    children: PropertyChildren,
  ): Promise<PropertyRecord | null>;
  delete(scope: PropertyScope, id: string): Promise<boolean>;

  isUsageAllowed(propertyType: PropertyType, usageType: UsageType): Promise<boolean>;
  subtypeBelongsTo(subtypeId: number, propertyType: PropertyType): Promise<boolean>;
  cityExists(cityId: number): Promise<boolean>;
  /** Whether the client exists in the organization and is visible within the scope. */
  clientVisible(scope: PropertyScope, clientId: string): Promise<boolean>;
}

function whereFor(scope: PropertyScope): Prisma.PropertyWhereInput {
  return {
    organizationId: scope.organizationId,
    ...(scope.createdById ? { createdById: scope.createdById } : {}),
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createPropertiesRepository(prisma: PrismaClient): PropertiesRepository {
  return {
    async list(scope, { search, propertyType, usageType, clientId, skip, take }) {
      const where: Prisma.PropertyWhereInput = {
        ...whereFor(scope),
        ...(propertyType ? { propertyType } : {}),
        ...(usageType ? { usageType } : {}),
        ...(clientId ? { clientId } : {}),
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.property.findMany({ where, select, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take }),
        prisma.property.count({ where }),
      ]);
      return { items, total };
    },

    findById(scope, id) {
      return prisma.property.findFirst({ where: { ...whereFor(scope), id }, select });
    },

    create(scope, data, children) {
      const { clientId, ...scalars } = data;
      return prisma.property.create({
        data: {
          ...scalars,
          organizationId: scope.organizationId,
          createdById: scope.createdById,
          // The composite FK (client_id, organization_id) is filled by Prisma from the scalar pair.
          ...(clientId ? { clientId } : {}),
          ...(children.address ? { address: { create: children.address } } : {}),
          ...(children.manualRental ? { manualRental: { create: children.manualRental } } : {}),
          ...(children.acquisition ? { acquisition: { create: children.acquisition } } : {}),
        },
        select,
      });
    },

    update(scope, id, data, children) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({ where: { ...whereFor(scope), id }, data });
        if (count === 0) return null;

        if (children.address === null) await tx.propertyAddress.deleteMany({ where: { propertyId: id } });
        else if (children.address) {
          await tx.propertyAddress.upsert({
            where: { propertyId: id },
            create: { propertyId: id, ...children.address },
            update: children.address,
          });
        }

        if (children.manualRental === null) await tx.propertyManualRental.deleteMany({ where: { propertyId: id } });
        else if (children.manualRental) {
          await tx.propertyManualRental.upsert({
            where: { propertyId: id },
            create: { propertyId: id, ...children.manualRental },
            update: children.manualRental,
          });
        }

        if (children.acquisition === null) await tx.propertyAcquisition.deleteMany({ where: { propertyId: id } });
        else if (children.acquisition) {
          await tx.propertyAcquisition.upsert({
            where: { propertyId: id },
            create: { propertyId: id, ...children.acquisition },
            update: children.acquisition,
          });
        }

        return tx.property.findFirst({ where: { ...whereFor(scope), id }, select });
      });
    },

    async delete(scope, id) {
      const { count } = await prisma.property.deleteMany({ where: { ...whereFor(scope), id } });
      return count > 0;
    },

    async isUsageAllowed(propertyType, usageType) {
      return (await prisma.propertyTypeUsage.count({ where: { propertyType, usageType } })) > 0;
    },

    async subtypeBelongsTo(subtypeId, propertyType) {
      return (await prisma.propertySubtype.count({ where: { id: subtypeId, propertyType } })) > 0;
    },

    async cityExists(cityId) {
      return (await prisma.city.count({ where: { ibgeCode: cityId } })) > 0;
    },

    async clientVisible(scope, clientId) {
      const where: Prisma.ClientWhereInput = {
        id: clientId,
        organizationId: scope.organizationId,
        ...(scope.createdById ? { createdById: scope.createdById } : {}),
      };
      return (await prisma.client.count({ where })) > 0;
    },
  };
}
