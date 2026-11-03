import { z } from "zod";

/** Raw HTML as sent by the editor; it is sanitized before it is stored. */
export const updateTemplateSchema = z.object({
  header: z.string().max(5_000),
  clauses: z.string().min(1).max(100_000),
  footer: z.string().max(5_000),
});

export type UpdateTemplateInput = z.output<typeof updateTemplateSchema>;
