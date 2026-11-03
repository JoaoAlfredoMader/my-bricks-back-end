import { z } from "zod";

/** Optional text field: blank means "no value" (`null`). */
export const optionalText = <TSchema extends z.ZodType<string>>(schema: TSchema) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullish());
