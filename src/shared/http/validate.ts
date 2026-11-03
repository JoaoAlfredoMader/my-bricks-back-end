import { validator } from "hono/validator";
import type { ZodType, z } from "zod";
import { AppError } from "../errors/app-error.js";

/** `form` is a multipart or url-encoded body; files arrive as `File` objects. */
type ValidationTarget = "json" | "query" | "param" | "form";

/**
 * Route-layer input validation. Hands the parsed (and transformed) value to the handler,
 * so controllers only ever receive validated input.
 */
export function validate<TSchema extends ZodType>(target: ValidationTarget, schema: TSchema) {
  return validator(target, (value): z.output<TSchema> => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
    return result.data;
  });
}
