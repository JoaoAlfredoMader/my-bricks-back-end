import type {
  AcquisitionType,
  AmortizationSystem,
  ConservationState,
  PropertyType,
  RegistrationStatus,
  RentalMode,
  UsageType,
} from "../../generated/prisma/enums.js";
import { centsToNumber } from "../../shared/money.js";
import type { PropertyRecord } from "./properties.repository.js";
import { derivePropertyStatus, type PropertyStatus } from "./property-status.js";

export interface PropertyAddressDto {
  cityId: number;
  city: string;
  state: string;
  postalCode: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Shape returned by the API. Money is integer cents, decimals are numbers, dates are ISO strings. */
export interface PropertyDto {
  id: string;
  name: string;
  propertyType: PropertyType;
  subtypeId: number | null;
  usageType: UsageType;
  /** Derived from usage and rental data, never stored. */
  status: PropertyStatus;
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
  estimatedValueCents: number | null;
  annualExpensesCents: number;
  occupancyRate: number;
  rentalMode: RentalMode;
  notes: string | null;
  clientId: string | null;
  agencyId: string | null;
  agencyName: string | null;
  address: PropertyAddressDto | null;
  manualRental: { tenantName: string | null; monthlyRentCents: number; dueDay: number | null } | null;
  acquisition: { acquisitionType: AcquisitionType; acquiredOn: string | null; costCents: number | null } | null;
  /** Only for properties acquired by purchase or construction. */
  financing: {
    lender: string | null;
    financedAmountCents: number;
    termMonths: number;
    /** Nominal rate per year, in percent. */
    annualInterestRate: number;
    amortizationSystem: AmortizationSystem;
    firstInstallmentOn: string;
  } | null;
  legalRecord: {
    registrationStatus: RegistrationStatus;
    irregularityDescription: string | null;
    registryNumber: string | null;
    registryOffice: string | null;
    notes: string | null;
  } | null;
  /** A row means the property is insured. */
  insurance: { description: string | null } | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

const decimal = (value: { toNumber(): number } | null) => (value === null ? null : value.toNumber());

export function toPropertyDto(record: PropertyRecord): PropertyDto {
  const { address, manualRental } = record;
  return {
    id: record.id,
    name: record.name,
    propertyType: record.propertyType,
    subtypeId: record.subtypeId,
    usageType: record.usageType,
    status: derivePropertyStatus({
      usageType: record.usageType,
      rentalMode: record.rentalMode,
      manualRental,
      hasActiveContract: record.contracts.length > 0,
    }),
    ownershipPercentage: record.ownershipPercentage.toNumber(),
    totalArea: decimal(record.totalArea),
    privateArea: decimal(record.privateArea),
    bedrooms: record.bedrooms,
    suites: record.suites,
    bathrooms: record.bathrooms,
    parkingSpaces: record.parkingSpaces,
    parkingSpotLabel: record.parkingSpotLabel,
    builtYear: record.builtYear,
    conservationState: record.conservationState,
    estimatedValueCents: record.estimatedValueCents === null ? null : centsToNumber(record.estimatedValueCents),
    annualExpensesCents: centsToNumber(record.annualExpensesCents),
    occupancyRate: record.occupancyRate.toNumber(),
    rentalMode: record.rentalMode,
    notes: record.notes,
    clientId: record.clientId,
    agencyId: record.agencyId,
    agencyName: record.agency?.name ?? null,
    address: address && {
      cityId: address.cityId,
      city: address.city.name,
      state: address.city.state,
      postalCode: address.postalCode,
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      latitude: decimal(address.latitude),
      longitude: decimal(address.longitude),
    },
    manualRental: manualRental && {
      tenantName: manualRental.tenantName,
      monthlyRentCents: centsToNumber(manualRental.monthlyRentCents),
      dueDay: manualRental.dueDay,
    },
    acquisition: record.acquisition && {
      acquisitionType: record.acquisition.acquisitionType,
      acquiredOn: record.acquisition.acquiredOn ? record.acquisition.acquiredOn.toISOString().slice(0, 10) : null,
      costCents: record.acquisition.costCents === null ? null : centsToNumber(record.acquisition.costCents),
    },
    financing: record.acquisition?.financing
      ? {
          lender: record.acquisition.financing.lender,
          financedAmountCents: centsToNumber(record.acquisition.financing.financedAmountCents),
          termMonths: record.acquisition.financing.termMonths,
          annualInterestRate: record.acquisition.financing.annualInterestRate.toNumber(),
          amortizationSystem: record.acquisition.financing.amortizationSystem,
          firstInstallmentOn: record.acquisition.financing.firstInstallmentOn.toISOString().slice(0, 10),
        }
      : null,
    legalRecord: record.legalRecord,
    insurance: record.insurance,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
