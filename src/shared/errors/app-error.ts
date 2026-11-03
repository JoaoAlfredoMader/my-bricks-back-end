import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "INTERNAL_ERROR";

/**
 * Typed domain error. Services throw it; the app-level error handler turns it into an HTTP response.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: ContentfulStatusCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static validation(details: unknown, message = "Invalid request"): AppError {
    return new AppError("VALIDATION_ERROR", message, 400, details);
  }

  static unauthenticated(message = "Authentication required"): AppError {
    return new AppError("UNAUTHENTICATED", message, 401);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError("NOT_FOUND", message, 404);
  }

  static forbidden(message = "You do not have access to this resource"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError("CONFLICT", message, 409, details);
  }

  static businessRule(message: string, details?: unknown): AppError {
    return new AppError("BUSINESS_RULE_VIOLATION", message, 422, details);
  }
}
