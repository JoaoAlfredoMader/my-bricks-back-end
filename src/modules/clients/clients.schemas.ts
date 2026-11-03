import { z } from "zod";
import { PersonType } from "../../generated/prisma/enums.js";
import { normalizeDocument } from "../../shared/validation/brazilian-document.js";
import { optionalText } from "../../shared/validation/optional-text.js";

const name = z.string().trim().min(2).max(255);
const personType = z.enum(PersonType);
const document = optionalText(z.string().trim().max(24).transform(normalizeDocument));
const email = optionalText(z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()));
const whatsapp = optionalText(
  z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().regex(/^\d{10,15}$/, "Enter the phone number with area code")),
);

export const createClientSchema = z.object({
  name,
  personType: personType.default("individual"),
  document,
  email,
  whatsapp,
});

export const updateClientSchema = z
  .object({ name, personType, document, email, whatsapp })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const listClientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  personType: personType.optional(),
});

export const clientIdParamSchema = z.object({ id: z.uuid() });

export type CreateClientInput = z.output<typeof createClientSchema>;
export type UpdateClientInput = z.output<typeof updateClientSchema>;
export type ListClientsInput = z.output<typeof listClientsQuerySchema>;
