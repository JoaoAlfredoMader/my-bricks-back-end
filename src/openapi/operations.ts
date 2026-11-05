import type { z } from "zod";

/** Who may call an operation. It drives the `security` of the spec and the automatic 401/403 answers. */
export type Access =
  /** No session needed. */
  | "public"
  /** Any signed-in user working in an organization. */
  | "session"
  /** Owners and admins of the organization. */
  | "owner-admin"
  /** The platform operator. */
  | "platform-admin";

export interface Operation {
  /** Unique; becomes the `operationId`, so it is the name of the function in a generated client. */
  id: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Hono style (`/api/clients/:id`); converted to `{id}` in the spec. */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: z.ZodObject;
  query?: z.ZodObject;
  /** A JSON request body. */
  body?: z.ZodType;
  /** A multipart request body; the `file` field is described as binary. */
  upload?: z.ZodObject;
  response: {
    status: 200 | 201 | 204;
    description: string;
    /** A registered response schema. Omit for 204. */
    schema?: z.ZodType;
    /** A file download instead of JSON. */
    binary?: { contentType: string; description?: string };
  };
  /** Error statuses beyond the ones every operation gets (401/403 by access, 400 for input, 404 for `:id`). */
  errors?: ReadonlyArray<404 | 409 | 413 | 415 | 422>;
}

export const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "The request is not valid: bad input, malformed JSON or a rule that spans several fields",
  401: "There is no valid session",
  403: "The session does not allow this",
  404: "The record does not exist, or it is outside what the caller may see (another organization, or another member's record)",
  409: "Conflicts with what is already there",
  413: "The file is over the upload limit",
  415: "The file type is not accepted, or its content is not what it claims to be",
  422: "A business rule forbids it",
};
