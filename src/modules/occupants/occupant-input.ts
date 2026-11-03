import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import { isValidCnpj, isValidCpf, normalizeDocument } from "../../shared/validation/brazilian-document.js";
import { optionalText } from "../../shared/validation/optional-text.js";
import type { OccupantData, OccupantLookup } from "./occupants.repository.js";

/** A new occupant described inline, shared by every module that attaches a person to a record. */
export const occupantInputSchema = z.object({
  name: z.string().trim().min(2).max(255),
  document: optionalText(
    z
      .string()
      .trim()
      .max(24)
      .transform(normalizeDocument)
      .refine((value) => isValidCpf(value) || isValidCnpj(value), "Invalid CPF or CNPJ"),
  ),
  email: optionalText(z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase())),
  phone: optionalText(
    z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{10,15}$/, "Enter the phone number with area code")),
  ),
});

export type OccupantInput = z.output<typeof occupantInputSchema>;

/** Either an occupant that already exists, or the data to create one inside the caller's transaction. */
export type OccupantRef = { existingId: string } | { create: OccupantData };

/**
 * Picks an existing occupant or describes a new one. A document already stored in the
 * organization reuses the stored occupant instead of duplicating it.
 */
export async function resolveOccupantRef(
  lookup: OccupantLookup,
  organizationId: string,
  input: { occupantId?: string | undefined; occupant?: OccupantInput | undefined },
): Promise<OccupantRef> {
  if (input.occupantId) {
    if (!(await lookup.occupantExists(organizationId, input.occupantId))) {
      throw AppError.validation([{ path: "occupantId", message: "Occupant not found" }]);
    }
    return { existingId: input.occupantId };
  }

  const occupant = input.occupant;
  if (!occupant) throw AppError.validation([{ path: "occupantId", message: "Send either occupantId or occupant" }]);

  if (occupant.document) {
    const existingId = await lookup.findOccupantIdByDocument(organizationId, occupant.document);
    if (existingId) return { existingId };
  }
  return {
    create: {
      name: occupant.name,
      document: occupant.document ?? null,
      email: occupant.email ?? null,
      phone: occupant.phone ?? null,
    },
  };
}
