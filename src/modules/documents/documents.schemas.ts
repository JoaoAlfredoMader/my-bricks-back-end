import { z } from "zod";
import { optionalText } from "../../shared/validation/optional-text.js";

const category = optionalText(z.string().trim().max(50));

export const uploadDocumentSchema = z.object({
  file: z.instanceof(File, { message: "Send the document in a multipart field named \"file\"" }),
  category,
});

export const updateDocumentSchema = z.object({ category: category.transform((value) => value ?? null) });

export const listDocumentsQuerySchema = z.object({ category: z.string().trim().min(1).max(50).optional() });

export const propertyParamSchema = z.object({ propertyId: z.uuid() });
export const documentParamsSchema = z.object({ propertyId: z.uuid(), id: z.uuid() });
