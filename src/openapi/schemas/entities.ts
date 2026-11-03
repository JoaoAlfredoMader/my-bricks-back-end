import { z } from "zod";
import {
  AcquisitionType,
  AdjustmentIndex,
  AmortizationSystem,
  ConservationState,
  ContractStatus,
  ContractType,
  PersonType,
  PropertyType,
  ProposalType,
  RegistrationStatus,
  RentalMode,
  ReservationStatus,
  TransactionType,
  UsageType,
} from "../../generated/prisma/enums.js";
import type { AgencyDto } from "../../modules/agencies/agencies.service.js";
import type { ClientDto } from "../../modules/clients/clients.dto.js";
import type { ContractCreatedDto, ContractDto } from "../../modules/contracts/contracts.dto.js";
import type { OccupantDto } from "../../modules/occupants/occupants.service.js";
import type { PropertyDto } from "../../modules/properties/properties.dto.js";
import type { ProposalDto } from "../../modules/proposals/proposals.dto.js";
import type { ReservationDto } from "../../modules/reservations/reservations.dto.js";
import type { TransactionDto } from "../../modules/transactions/transactions.dto.js";
import { cents, date, nullable, output, pageOf, timestamp } from "./common.js";

// Each schema is checked against the TypeScript DTO the service returns (`satisfies`), and the
// contract tests parse real responses with it: a field added to a DTO without being added here
// breaks the build or a test, never the front-end.

// ── clients, agencies, occupants ────────────────────────────────────────────

export const clientSchema = output(
  "Client",
  z.object({
    id: z.uuid(),
    name: z.string(),
    personType: z.enum(PersonType),
    document: nullable(z.string()).describe("CPF or CNPJ without punctuation"),
    email: nullable(z.string()),
    whatsapp: nullable(z.string()).describe("Digits only, area code included"),
    createdById: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }) satisfies z.ZodType<ClientDto>,
);
export const clientPageSchema = output("ClientPage", pageOf(clientSchema));

export const agencySchema = output("Agency", z.object({ id: z.uuid(), name: z.string() }) satisfies z.ZodType<AgencyDto>);
export const agencyPageSchema = output("AgencyPage", pageOf(agencySchema));

export const occupantSchema = output(
  "Occupant",
  z.object({
    id: z.uuid(),
    name: z.string(),
    document: nullable(z.string()),
    email: nullable(z.string()),
    phone: nullable(z.string()),
  }) satisfies z.ZodType<OccupantDto>,
);
export const occupantPageSchema = output("OccupantPage", pageOf(occupantSchema));

// ── properties ──────────────────────────────────────────────────────────────

export const propertyStatusSchema = z
  .enum(["own_use", "loan_for_use", "rented", "vacant"])
  .describe("Derived, never stored: own use and loan for use follow the usage; otherwise rented when there is a tenant, rent or an active contract");

export const propertySchema = output(
  "Property",
  z.object({
    id: z.uuid(),
    name: z.string(),
    propertyType: z.enum(PropertyType),
    subtypeId: nullable(z.number().int()),
    usageType: z.enum(UsageType),
    status: propertyStatusSchema,
    ownershipPercentage: z.number(),
    totalArea: nullable(z.number()),
    privateArea: nullable(z.number()),
    bedrooms: nullable(z.number().int()),
    suites: nullable(z.number().int()),
    bathrooms: nullable(z.number().int()),
    parkingSpaces: nullable(z.number().int()),
    parkingSpotLabel: nullable(z.string()),
    builtYear: nullable(z.number().int()),
    conservationState: nullable(z.enum(ConservationState)),
    estimatedValueCents: nullable(cents),
    annualExpensesCents: cents,
    occupancyRate: z.number().describe("Expected occupancy, 0 to 100"),
    rentalMode: z.enum(RentalMode),
    notes: nullable(z.string()),
    clientId: nullable(z.string()),
    agencyId: nullable(z.string()),
    agencyName: nullable(z.string()),
    address: nullable(
      z.object({
        cityId: z.number().int().describe("IBGE municipality code"),
        city: z.string(),
        state: z.string(),
        postalCode: nullable(z.string()),
        street: z.string(),
        number: nullable(z.string()),
        complement: nullable(z.string()),
        neighborhood: nullable(z.string()),
        latitude: nullable(z.number()),
        longitude: nullable(z.number()),
      }),
    ),
    manualRental: nullable(z.object({ tenantName: nullable(z.string()), monthlyRentCents: cents, dueDay: nullable(z.number().int()) })),
    acquisition: nullable(
      z.object({ acquisitionType: z.enum(AcquisitionType), acquiredOn: nullable(date), costCents: nullable(cents) }),
    ),
    financing: nullable(
      z.object({
        lender: nullable(z.string()),
        financedAmountCents: cents,
        termMonths: z.number().int(),
        annualInterestRate: z.number().describe("Nominal rate per year, in percent"),
        amortizationSystem: z.enum(AmortizationSystem),
        firstInstallmentOn: date,
      }),
    ),
    legalRecord: nullable(
      z.object({
        registrationStatus: z.enum(RegistrationStatus),
        irregularityDescription: nullable(z.string()),
        registryNumber: nullable(z.string()),
        registryOffice: nullable(z.string()),
        notes: nullable(z.string()),
      }),
    ),
    insurance: nullable(z.object({ description: nullable(z.string()) })).describe("A value means the property is insured"),
    createdById: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }) satisfies z.ZodType<PropertyDto>,
);
export const propertyPageSchema = output("PropertyPage", pageOf(propertySchema));

// ── contracts, reservations ─────────────────────────────────────────────────

const contractFields = {
  id: z.uuid(),
  propertyId: z.uuid(),
  propertyName: z.string(),
  contractType: z.enum(ContractType),
  status: z.enum(ContractStatus),
  startDate: date,
  endDate: nullable(date).describe("null = open-ended"),
  notes: nullable(z.string()),
  occupant: z.object({
    id: z.uuid(),
    name: z.string(),
    document: nullable(z.string()),
    email: nullable(z.string()),
    phone: nullable(z.string()),
  }),
  rentTerms: nullable(z.object({ monthlyRentCents: cents, dueDay: z.number().int(), adjustmentIndex: nullable(z.enum(AdjustmentIndex)) })).describe(
    "Conventional contracts only",
  ),
  pdfUrl: nullable(z.string()).describe("Path of the generated PDF, once there is one"),
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const contractSchema = output("Contract", z.object(contractFields) satisfies z.ZodType<ContractDto>);
export const contractCreatedSchema = output(
  "ContractCreated",
  z.object({
    ...contractFields,
    replacedContractId: nullable(z.string()).describe("The active contract this one replaced, if the property had one"),
  }) satisfies z.ZodType<ContractCreatedDto>,
);
export const contractPageSchema = output("ContractPage", pageOf(contractSchema));

export const reservationSchema = output(
  "Reservation",
  z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    contractId: nullable(z.string()),
    guest: z.object({ id: z.uuid(), name: z.string(), document: nullable(z.string()), email: nullable(z.string()), phone: nullable(z.string()) }),
    checkIn: date,
    checkOut: date,
    nights: z.number().int().describe("Derived from the dates"),
    totalAmountCents: cents,
    status: z.enum(ReservationStatus),
    notes: nullable(z.string()),
    createdAt: timestamp,
    updatedAt: timestamp,
  }) satisfies z.ZodType<ReservationDto>,
);
export const reservationPageSchema = output("ReservationPage", pageOf(reservationSchema));

// ── transactions, proposals ─────────────────────────────────────────────────

export const transactionSchema = output(
  "Transaction",
  z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    categoryId: z.number().int(),
    categoryName: z.string(),
    type: z.enum(TransactionType).describe("Derived from the category: revenue or expense"),
    amountCents: cents.describe("Always positive; `type` tells revenue from expense"),
    occurredOn: date,
    description: nullable(z.string()),
    isRecurring: z.boolean(),
    recurrenceEndsOn: nullable(date),
    createdAt: timestamp,
    updatedAt: timestamp,
  }) satisfies z.ZodType<TransactionDto>,
);
export const transactionPageSchema = output("TransactionPage", pageOf(transactionSchema));

export const proposalSchema = output(
  "Proposal",
  z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    proposalType: z.enum(ProposalType),
    amountCents: cents,
    proposalDate: date,
    contact: nullable(z.string()),
    notes: nullable(z.string()),
    createdAt: timestamp,
  }) satisfies z.ZodType<ProposalDto>,
);
export const proposalPageSchema = output("ProposalPage", pageOf(proposalSchema));
