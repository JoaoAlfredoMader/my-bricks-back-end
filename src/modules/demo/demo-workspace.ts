import type { PrismaClient } from "../../lib/prisma.js";
import { type DemoPlan, type DemoProperty, buildDemoPlan } from "./demo-data.js";

export interface DemoSeeder {
  /** Fills a guest's demo organization with a sample portfolio. The guest becomes the author of everything. */
  seed(input: { organizationId: string; ownerUserId: string }): Promise<void>;
}

export interface DemoSeederOptions {
  /** The calendar day the sample portfolio is built around; injectable for tests. */
  today?: () => Date;
}

const startOfToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** Writes a plan into one organization, in a single transaction: either all of it or none. */
export function createDemoSeeder(prisma: PrismaClient, { today = startOfToday }: DemoSeederOptions = {}): DemoSeeder {
  return {
    async seed({ organizationId, ownerUserId }) {
      const plan = buildDemoPlan(today());

      // Reference data is looked up first, outside the transaction.
      const subtypes = new Map((await prisma.propertySubtype.findMany()).map((s) => [`${s.propertyType}:${s.name}`, s.id]));
      const categories = new Map((await prisma.transactionCategory.findMany()).map((c) => [`${c.transactionType}:${c.name}`, c.id]));
      const cities = new Map<string, number>();
      for (const { city, state } of new Set(plan.properties.map((p) => ({ city: p.address.city, state: p.address.state })))) {
        const found = await prisma.city.findFirst({ where: { name: city, state }, select: { ibgeCode: true } });
        if (!found) throw new Error(`Demo data needs the city ${city}/${state}: run the database seed`);
        cities.set(`${city}/${state}`, found.ibgeCode);
      }
      const lookup = <T>(map: Map<string, T>, key: string, what: string): T => {
        const value = map.get(key);
        if (value === undefined) throw new Error(`Demo data needs the ${what} "${key}": run the database seed`);
        return value;
      };

      await prisma.$transaction(
        async (tx) => {
          const agencyIds = new Map<string, string>();
          for (const agency of plan.agencies) {
            agencyIds.set(agency.key, (await tx.agency.create({ data: { organizationId, name: agency.name }, select: { id: true } })).id);
          }

          const clientIds = new Map<string, string>();
          for (const { key, ...client } of plan.clients) {
            clientIds.set(key, (await tx.client.create({ data: { ...client, organizationId, createdById: ownerUserId }, select: { id: true } })).id);
          }

          const occupantIds = new Map<string, string>();
          for (const { key, ...occupant } of plan.occupants) {
            occupantIds.set(key, (await tx.occupant.create({ data: { ...occupant, organizationId }, select: { id: true } })).id);
          }

          const propertyIds = new Map<string, string>();
          for (const property of plan.properties) {
            propertyIds.set(property.key, await createProperty(tx, property));
          }

          async function createProperty(client: Pick<typeof tx, "property">, property: DemoProperty): Promise<string> {
            const { financing, acquisition, address, manualRental, legalRecord, insurance } = property;
            const created = await client.property.create({
              data: {
                organizationId,
                createdById: ownerUserId,
                name: property.name,
                propertyType: property.propertyType,
                subtypeId: lookup(subtypes, `${property.propertyType}:${property.subtype}`, "property subtype"),
                usageType: property.usageType,
                rentalMode: property.rentalMode,
                ...(property.clientKey ? { clientId: clientIds.get(property.clientKey)! } : {}),
                ...(property.agencyKey ? { agencyId: agencyIds.get(property.agencyKey)! } : {}),
                ownershipPercentage: property.ownershipPercentage,
                totalArea: property.totalArea ?? null,
                privateArea: property.privateArea ?? null,
                bedrooms: property.bedrooms ?? null,
                bathrooms: property.bathrooms ?? null,
                parkingSpaces: property.parkingSpaces ?? null,
                parkingSpotLabel: property.parkingSpotLabel ?? null,
                builtYear: property.builtYear ?? null,
                conservationState: property.conservationState ?? null,
                estimatedValueCents: BigInt(property.estimatedValueCents),
                annualExpensesCents: BigInt(property.annualExpensesCents),
                occupancyRate: property.occupancyRate,
                notes: property.notes ?? null,
                address: {
                  create: {
                    cityId: lookup(cities, `${address.city}/${address.state}`, "city"),
                    postalCode: address.postalCode,
                    street: address.street,
                    number: address.number,
                    complement: address.complement ?? null,
                    neighborhood: address.neighborhood,
                  },
                },
                ...(manualRental ? { manualRental: { create: { ...manualRental, monthlyRentCents: BigInt(manualRental.monthlyRentCents) } } } : {}),
                ...(acquisition
                  ? {
                      acquisition: {
                        create: {
                          acquisitionType: acquisition.acquisitionType,
                          acquiredOn: acquisition.acquiredOn,
                          costCents: BigInt(acquisition.costCents),
                          ...(financing ? { financing: { create: { ...financing, financedAmountCents: BigInt(financing.financedAmountCents) } } } : {}),
                        },
                      },
                    }
                  : {}),
                ...(legalRecord ? { legalRecord: { create: { ...legalRecord, irregularityDescription: legalRecord.irregularityDescription ?? null } } } : {}),
                ...(insurance ? { insurance: { create: insurance } } : {}),
              },
              select: { id: true },
            });
            return created.id;
          }

          const contractIds = new Map<string, string>();
          for (const contract of plan.contracts) {
            const created = await tx.contract.create({
              data: {
                organizationId,
                propertyId: propertyIds.get(contract.propertyKey)!,
                occupantId: occupantIds.get(contract.occupantKey)!,
                contractType: contract.contractType,
                status: contract.status,
                startDate: contract.startDate,
                endDate: contract.endDate,
                notes: contract.notes ?? null,
                ...(contract.rentTerms ? { rentTerms: { create: { ...contract.rentTerms, monthlyRentCents: BigInt(contract.rentTerms.monthlyRentCents) } } } : {}),
              },
              select: { id: true },
            });
            contractIds.set(contract.key, created.id);
          }

          for (const reservation of plan.reservations) {
            await tx.reservation.create({
              data: {
                organizationId,
                propertyId: propertyIds.get(reservation.propertyKey)!,
                contractId: contractIds.get(reservation.contractKey)!,
                occupantId: occupantIds.get(reservation.occupantKey)!,
                checkIn: reservation.checkIn,
                checkOut: reservation.checkOut,
                totalAmountCents: BigInt(reservation.totalAmountCents),
                status: reservation.status,
              },
            });
          }

          for (const transaction of plan.transactions) {
            await tx.transaction.create({
              data: {
                organizationId,
                propertyId: propertyIds.get(transaction.propertyKey)!,
                categoryId: lookup(categories, `${transaction.category.type}:${transaction.category.name}`, "transaction category"),
                amountCents: BigInt(transaction.amountCents),
                occurredOn: transaction.occurredOn,
                description: transaction.description,
                isRecurring: transaction.isRecurring,
                recurrenceEndsOn: transaction.recurrenceEndsOn ?? null,
              },
            });
          }

          for (const proposal of plan.proposals) {
            await tx.propertyProposal.create({
              data: {
                propertyId: propertyIds.get(proposal.propertyKey)!,
                proposalType: proposal.proposalType,
                amountCents: BigInt(proposal.amountCents),
                proposalDate: proposal.proposalDate,
                contact: proposal.contact,
                notes: proposal.notes ?? null,
              },
            });
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },
  };
}

/** A summary of what a plan contains, for logs and tests. */
export function describePlan(plan: DemoPlan): Record<string, number> {
  return {
    agencies: plan.agencies.length,
    clients: plan.clients.length,
    occupants: plan.occupants.length,
    properties: plan.properties.length,
    contracts: plan.contracts.length,
    reservations: plan.reservations.length,
    transactions: plan.transactions.length,
    proposals: plan.proposals.length,
  };
}
