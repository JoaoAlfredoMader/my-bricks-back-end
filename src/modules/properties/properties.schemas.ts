import { z } from "zod";
import { AcquisitionType, ConservationState, PropertyType, RentalMode, UsageType } from "../../generated/prisma/enums.js";
import { optionalText } from "../../shared/validation/optional-text.js";

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const smallCount = z.number().int().min(0).max(999);
const area = z.number().min(0).max(9_999_999_999);

const addressSchema = z.object({
  cityId: z.number().int().positive(),
  postalCode: optionalText(
    z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{8}$/, "Postal code must have 8 digits"))
      .transform((digits) => `${digits.slice(0, 5)}-${digits.slice(5)}`),
  ),
  street: z.string().trim().min(1).max(255),
  number: optionalText(z.string().trim().max(20)),
  complement: optionalText(z.string().trim().max(100)),
  neighborhood: optionalText(z.string().trim().max(100)),
});

/** Calendar date as `YYYY-MM-DD`. */
const date = z.iso.date();

/** How the property was acquired. It is the start of the IRR period and the base of its cost. */
const acquisitionSchema = z
  .object({
    acquisitionType: z.enum(AcquisitionType),
    /** Purchase date, or base date for an inheritance. */
    acquiredOn: date.nullish(),
    /** Purchase price, or base cost for an inheritance. Without it the IRR is not available. */
    costCents: cents.nullish(),
  })
  .superRefine((input, context) => {
    if (input.acquisitionType === "inheritance" && !input.acquiredOn) {
      context.addIssue({ code: "custom", path: ["acquiredOn"], message: "An inheritance needs a base date" });
    }
  });

const manualRentalSchema = z.object({
  tenantName: optionalText(z.string().trim().max(255)),
  monthlyRentCents: cents.default(0),
  dueDay: z.number().int().min(1).max(31).nullish(),
});

/** Fields shared by create and patch. Defaults are applied only on create. */
const fields = {
  name: z.string().trim().min(2).max(255),
  propertyType: z.enum(PropertyType),
  subtypeId: z.number().int().positive().nullish(),
  usageType: z.enum(UsageType),
  ownershipPercentage: z.number().gt(0).max(100),
  totalArea: area.nullish(),
  privateArea: area.nullish(),
  bedrooms: smallCount.nullish(),
  suites: smallCount.nullish(),
  bathrooms: smallCount.nullish(),
  parkingSpaces: smallCount.nullish(),
  parkingSpotLabel: optionalText(z.string().trim().max(50)),
  builtYear: z.number().int().min(1500).max(2200).nullish(),
  conservationState: z.enum(ConservationState).nullish(),
  estimatedValueCents: cents.nullish(),
  annualExpensesCents: cents,
  occupancyRate: z.number().min(0).max(100),
  rentalMode: z.enum(RentalMode),
  notes: optionalText(z.string().trim().max(10_000)),
  clientId: z.uuid().nullish(),
  /** The agency that manages the property, if any. */
  agencyId: z.uuid().nullish(),
};

export const createPropertySchema = z.object({
  ...fields,
  ownershipPercentage: fields.ownershipPercentage.default(100),
  annualExpensesCents: fields.annualExpensesCents.default(0),
  occupancyRate: fields.occupancyRate.default(90),
  rentalMode: fields.rentalMode.default("manual"),
  address: addressSchema.nullish(),
  manualRental: manualRentalSchema.nullish(),
  acquisition: acquisitionSchema.nullish(),
});

/** `null` on a nullable field clears it; on `address` / `manualRental` / `acquisition` it removes the child. */
export const updatePropertySchema = z
  .object({
    ...fields,
    address: addressSchema.nullable(),
    manualRental: manualRentalSchema.nullable(),
    acquisition: acquisitionSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const listPropertiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  propertyType: z.enum(PropertyType).optional(),
  usageType: z.enum(UsageType).optional(),
  clientId: z.uuid().optional(),
});

export const propertyIdParamSchema = z.object({ id: z.uuid() });

export type CreatePropertyInput = z.output<typeof createPropertySchema>;
export type UpdatePropertyInput = z.output<typeof updatePropertySchema>;
export type ListPropertiesInput = z.output<typeof listPropertiesQuerySchema>;
