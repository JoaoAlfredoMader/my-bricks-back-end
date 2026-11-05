import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { centsToNumber } from "../../shared/money.js";
import { derivePropertyStatus, type PropertyStatus } from "../properties/property-status.js";
import {
  aggregatePortfolio,
  computeCashFlow,
  computeIrr,
  computePropertyKpis,
  type CashFlowRevenue,
  type MonthKey,
  type PropertyKpis,
  type RentBasis,
} from "./kpi-calculations.js";
import type { CashFlowDto, PortfolioKpisDto, PropertyKpisDto, RevenueSource } from "./kpis.dto.js";
import type { CashFlowPropertyRecord, KpiScope, KpisRepository, PropertyKpiRecord } from "./kpis.repository.js";

export interface CashFlowInput {
  /** `YYYY-MM`, already validated. */
  from: MonthKey;
  to: MonthKey;
  /** One property as a whole; without it, the whole visible portfolio weighted by ownership share. */
  propertyId?: string | undefined;
}

export interface KpisService {
  property(tenant: TenantScope, id: string, options: { asOf?: string | undefined }): Promise<PropertyKpisDto>;
  portfolio(tenant: TenantScope, options: { asOf?: string | undefined; clientId?: string | undefined }): Promise<PortfolioKpisDto>;
  cashFlow(tenant: TenantScope, input: CashFlowInput): Promise<CashFlowDto>;
}

/** Owners and admins see the whole organization; members only the properties they created. */
function visibleScope(tenant: TenantScope): KpiScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { createdById: tenant.userId }),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** The 12 months of bookings that count as realized revenue: `[asOf - 1 year, asOf]`. */
function reservationWindow(asOf: string): { reservationsFrom: Date; reservationsTo: Date } {
  const to = toDate(asOf);
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { reservationsFrom: from, reservationsTo: to };
}

/**
 * Manual mode takes the rent typed on the property. Contract mode takes the rent of the active
 * conventional contract, or, for short-stay properties, the monthly average of the last 12 months
 * of confirmed bookings (that revenue is realized, so the expected occupancy does not apply to it).
 */
function resolveRent(record: PropertyKpiRecord): { rent: RentBasis; source: RevenueSource } {
  if (record.rentalMode === "manual") {
    const monthly = record.manualRental ? centsToNumber(record.manualRental.monthlyRentCents) : 0;
    return monthly > 0 ? { rent: { kind: "nominal", monthlyCents: monthly }, source: "manual" } : { rent: { kind: "none" }, source: "none" };
  }

  if (record.usageType === "short_stay") {
    const booked = centsToNumber(record.reservationsTotalCents);
    return booked > 0
      ? { rent: { kind: "realized", monthlyCents: booked / 12 }, source: "reservations" }
      : { rent: { kind: "none" }, source: "none" };
  }

  const contract = record.activeContract;
  if (contract?.contractType === "conventional" && contract.monthlyRentCents !== null) {
    return { rent: { kind: "nominal", monthlyCents: centsToNumber(contract.monthlyRentCents) }, source: "contract" };
  }
  return { rent: { kind: "none" }, source: "none" };
}

/** First and last day of the months `from` and `to` (`YYYY-MM`). */
function monthWindow(from: MonthKey, to: MonthKey): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1)),
    to: new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)),
  };
}

/**
 * Chooses the income the same way `resolveRent` does for the KPIs: manual mode takes the typed rent,
 * short-stay properties take their bookings, every other property takes its conventional contracts.
 * A contract that was ended without a date stops in the month it was ended.
 */
function resolveCashFlowRevenue(record: CashFlowPropertyRecord): CashFlowRevenue {
  if (record.rentalMode === "manual") {
    const monthly = record.manualMonthlyRentCents ? centsToNumber(record.manualMonthlyRentCents) : 0;
    return monthly > 0 ? { kind: "manual", monthlyCents: monthly } : { kind: "none" };
  }
  if (record.usageType === "short_stay") {
    return {
      kind: "reservations",
      reservations: record.reservations.map((reservation) => ({
        checkIn: toDateOnly(reservation.checkIn),
        totalCents: centsToNumber(reservation.totalAmountCents),
      })),
    };
  }
  return {
    kind: "contracts",
    periods: record.contracts.map((contract) => ({
      monthlyCents: centsToNumber(contract.monthlyRentCents),
      startsOn: toDateOnly(contract.startDate),
      endsOn: contract.endDate ? toDateOnly(contract.endDate) : contract.status === "ended" ? toDateOnly(contract.updatedAt) : null,
    })),
  };
}

interface Computed {
  dto: PropertyKpisDto;
  kpis: PropertyKpis;
  estimatedValueCents: number | null;
  status: PropertyStatus;
}

function compute(record: PropertyKpiRecord, asOf: string): Computed {
  const { rent, source } = resolveRent(record);
  const estimatedValueCents = record.estimatedValueCents === null ? null : centsToNumber(record.estimatedValueCents);

  const kpis = computePropertyKpis({
    usageType: record.usageType,
    ownershipPercentage: record.ownershipPercentage,
    estimatedValueCents,
    annualExpensesCents: centsToNumber(record.annualExpensesCents),
    occupancyRate: record.occupancyRate,
    rent,
  });

  const irr = computeIrr({
    acquiredOn: record.acquisition?.acquiredOn ? toDateOnly(record.acquisition.acquiredOn) : null,
    costCents: record.acquisition?.costCents == null ? null : centsToNumber(record.acquisition.costCents),
    estimatedValueCents,
    operatingMonthlyCents: kpis.noiCents / 12,
    transactions: record.transactions.map((transaction) => ({
      occurredOn: toDateOnly(transaction.occurredOn),
      signedAmountCents:
        (transaction.transactionType === "revenue" ? 1 : -1) * centsToNumber(transaction.amountCents),
      isRecurring: transaction.isRecurring,
      recurrenceEndsOn: transaction.recurrenceEndsOn ? toDateOnly(transaction.recurrenceEndsOn) : null,
    })),
    asOf,
  });

  const status = derivePropertyStatus({
    usageType: record.usageType,
    rentalMode: record.rentalMode,
    manualRental: record.manualRental,
    hasActiveContract: record.activeContract !== null,
  });

  return {
    kpis,
    estimatedValueCents,
    status,
    dto: {
      propertyId: record.id,
      name: record.name,
      clientId: record.clientId,
      usageType: record.usageType,
      status,
      ownershipPercentage: record.ownershipPercentage,
      estimatedValueCents,
      revenueSource: source,
      monthlyRentCents: rent.kind === "none" ? 0 : Math.round(rent.monthlyCents),
      includedInPortfolio: kpis.includedInPortfolio,
      annualRevenueCents: kpis.annualRevenueCents,
      annualExpensesCents: kpis.annualExpensesCents,
      noiCents: kpis.noiCents,
      grossYield: kpis.grossYield,
      capRate: kpis.capRate,
      irr: { annualRate: irr.annualRate, unavailableReason: irr.unavailableReason, months: irr.months },
    },
  };
}

/** Service layer: turns stored data into KPIs. No HTTP, no Prisma. */
export function createKpisService(repository: KpisRepository): KpisService {
  return {
    async property(tenant, id, { asOf = today() }) {
      const [record] = await repository.loadProperties(visibleScope(tenant), { propertyId: id, ...reservationWindow(asOf) });
      if (!record) throw AppError.notFound("Property not found");
      return compute(record, asOf).dto;
    },

    async portfolio(tenant, { asOf = today(), clientId }) {
      const records = await repository.loadProperties(visibleScope(tenant), {
        ...(clientId ? { clientId } : {}),
        ...reservationWindow(asOf),
      });
      const computed = records.map((record) => ({ record, ...compute(record, asOf) }));

      const propertiesByStatus: Record<PropertyStatus, number> = { own_use: 0, loan_for_use: 0, rented: 0, vacant: 0 };
      for (const { status } of computed) propertiesByStatus[status] += 1;

      return {
        asOf,
        totals: aggregatePortfolio(
          computed.map(({ record, kpis, estimatedValueCents }) => ({
            ownershipPercentage: record.ownershipPercentage,
            estimatedValueCents,
            kpis,
          })),
        ),
        propertyCount: computed.length,
        propertiesByStatus,
        properties: computed.map(({ dto }) => dto),
      };
    },

    async cashFlow(tenant, { from, to, propertyId }) {
      const records = await repository.loadCashFlow(visibleScope(tenant), {
        ...(propertyId ? { propertyId } : {}),
        ...monthWindow(from, to),
      });
      if (propertyId && records.length === 0) throw AppError.notFound("Property not found");

      return computeCashFlow({
        from,
        to,
        view: propertyId ? "property" : "portfolio",
        properties: records.map((record) => ({
          // One property is reported as a whole; the portfolio is weighted by ownership share, like /portfolio.
          share: propertyId ? 100 : record.ownershipPercentage,
          usageType: record.usageType,
          occupancyRate: record.occupancyRate,
          annualExpensesCents: centsToNumber(record.annualExpensesCents),
          revenue: resolveCashFlowRevenue(record),
          transactions: record.transactions.map((transaction) => ({
            occurredOn: toDateOnly(transaction.occurredOn),
            signedAmountCents: (transaction.transactionType === "revenue" ? 1 : -1) * centsToNumber(transaction.amountCents),
            isRecurring: transaction.isRecurring,
            recurrenceEndsOn: transaction.recurrenceEndsOn ? toDateOnly(transaction.recurrenceEndsOn) : null,
          })),
        })),
      });
    },
  };
}
