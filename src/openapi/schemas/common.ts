import { z } from "zod";

/** Components of the spec. Every response body is a named schema, registered here. */
export const outputs = z.registry<{ id: string }>();
/** Named request bodies. Converted with `io: "input"`, so defaults and optional fields read right. */
export const inputs = z.registry<{ id: string }>();

/** Registers a response schema as a component and returns it unchanged. */
export function output<T extends z.ZodType>(id: string, schema: T): T {
  outputs.add(schema, { id });
  return schema;
}

/** Registers a request body as a component and returns it unchanged. */
export function input<T extends z.ZodType>(id: string, schema: T): T {
  inputs.add(schema, { id });
  return schema;
}

export const cents = z.number().int().describe("Amount in integer cents (BRL)");
export const date = z.string().describe("Calendar date, YYYY-MM-DD");
export const timestamp = z.string().describe("ISO 8601 timestamp");
export const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().describe("1-based page number"),
    pageSize: z.number().int(),
    total: z.number().int().describe("Total number of items across all pages"),
  });

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "BUSINESS_RULE_VIOLATION",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR",
] as const;

/** The shape of every error the API answers. */
export const errorResponse = output(
  "ErrorResponse",
  z.object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z
        .unknown()
        .optional()
        .describe("Validation errors are a list of { path, message }; conflicts and limits carry the data that explains them"),
    }),
  }),
);
