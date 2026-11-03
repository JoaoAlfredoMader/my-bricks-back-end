import { z } from "zod";
import { ERROR_DESCRIPTIONS, type Operation } from "./operations.js";
import { OPERATIONS, TAGS } from "./routes.js";
import { errorResponse, inputs, outputs } from "./schemas/common.js";

type Json = Record<string, unknown>;

export interface SpecOptions {
  /** Where the API is reachable; the first entry of `servers`. */
  serverUrl: string;
  version?: string;
}

const COMPONENT = (id: string) => `#/components/schemas/${id}`;

/**
 * Takes out what Zod adds that only makes the document noisier: the long regular expression next
 * to every `format: uuid`, the "largest safe integer" bound on every integer, and ids/drafts.
 */
function tidy<T>(node: T): T {
  if (Array.isArray(node)) return node.map(tidy) as T;
  if (node === null || typeof node !== "object") return node;

  const entries = Object.entries(node as Json).filter(([key, value]) => {
    if (key === "$schema" || key === "$id") return false;
    if (key === "pattern" && (node as Json).format === "uuid") return false;
    if ((key === "maximum" || key === "minimum") && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER) return false;
    return true;
  });
  return Object.fromEntries(entries.map(([key, value]) => [key, tidy(value)])) as T;
}

/** The cookie Better Auth sets on sign-in (it gets a `__Secure-` prefix over HTTPS). */
const SESSION_COOKIE = "better-auth.session_token";

const DESCRIPTION = `
The back-end of **MyBricks**, a real-estate portfolio manager.

**Authentication.** Sign-in, sign-up, guest mode, invitations and the admin plugin are served by Better Auth under \`/api/auth/*\` (see its own reference at \`/api/auth/reference\`). They set a session cookie; every other endpoint reads it. The organization a request works in comes from the session, never from the client.

**Conventions.**
- Money is always an integer number of **cents** (BRL). Rates, yields and the IRR are fractions (\`0.07\` is 7%), except where a field says "percent".
- Calendar dates are \`YYYY-MM-DD\`; timestamps are ISO 8601.
- Lists are paginated: \`?page=1&pageSize=20\` (at most 100) and answer \`{ items, page, pageSize, total }\`.
- Errors always look like \`{ "error": { "code", "message", "details"? } }\`.
- **Visibility.** Owners and admins see every record of the organization; members only the ones they created. Something outside what the caller may see answers \`404\`, never \`403\`, so ids of other people's records do not leak.
`.trim();

/** Registries -> `components.schemas`, with the references between them pointing at each other. */
function componentSchemas(): Json {
  const convert = (registry: typeof outputs, io: "input" | "output") => {
    const { schemas } = z.toJSONSchema(registry, { io, unrepresentable: "any", uri: COMPONENT }) as unknown as { schemas: Record<string, Json> };
    return Object.fromEntries(
      Object.entries(schemas).map(([id, schema]) => {
        const { $schema: _schema, id: _id, ...rest } = schema;
        return [id, rest];
      }),
    );
  };
  const result = { ...convert(outputs, "output"), ...convert(inputs, "input") };
  const clashes = Object.keys(convert(outputs, "output")).filter((id) => id in convert(inputs, "input"));
  if (clashes.length > 0) throw new Error(`Component names used for both a request and a response: ${clashes.join(", ")}`);
  return result;
}

const stripDraft = (schema: Json): Json => {
  const { $schema: _schema, ...rest } = schema;
  return rest;
};

/** An object schema -> parameters of the operation (query string or path). */
function parametersOf(schema: z.ZodObject, where: "query" | "path"): Json[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const { description, ...shape } = stripDraft(property);
    return {
      name,
      in: where,
      required: where === "path" || (json.required ?? []).includes(name),
      ...(description ? { description } : {}),
      schema: tidy(shape),
    };
  });
}

function refTo(registry: typeof outputs, schema: z.ZodType, what: string): Json {
  const meta = registry.get(schema);
  if (!meta?.id) throw new Error(`${what} is not registered as a component: wrap it with output()/input()`);
  return { $ref: COMPONENT(meta.id) };
}

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");
const pathParamNames = (path: string) => [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!);

function errorStatuses(operation: Operation): number[] {
  const statuses = new Set<number>(operation.errors ?? []);
  if (operation.access !== "public") statuses.add(401);
  if (operation.access === "owner-admin" || operation.access === "platform-admin") statuses.add(403);
  if (operation.params || operation.query || operation.body || operation.upload) statuses.add(400);
  if (pathParamNames(operation.path).length > 0) statuses.add(404);
  return [...statuses].sort((a, b) => a - b);
}

function buildOperation(operation: Operation): Json {
  const where = `${operation.method.toUpperCase()} ${operation.path}`;

  // The schema of the path parameters and the path itself must agree.
  const inPath = pathParamNames(operation.path);
  const described = operation.params ? Object.keys(operation.params.shape) : [];
  if (inPath.join() !== described.join() && [...inPath].sort().join() !== [...described].sort().join()) {
    throw new Error(`${where}: the path has parameters [${inPath}] but its schema describes [${described}]`);
  }

  const parameters = [
    ...(operation.params ? parametersOf(operation.params, "path") : []),
    ...(operation.query ? parametersOf(operation.query, "query") : []),
  ];

  let requestBody: Json | undefined;
  if (operation.body) {
    requestBody = { required: true, content: { "application/json": { schema: refTo(inputs, operation.body, `${where} request body`) } } };
  } else if (operation.upload) {
    const json = z.toJSONSchema(operation.upload, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, Json>; required?: string[] };
    const { $schema: _schema, ...schema } = json as Json;
    requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: tidy({ ...schema, properties: { ...json.properties, file: { type: "string", format: "binary", description: "The file" } } }),
        },
      },
    };
  }

  const { response } = operation;
  const success: Json = { description: response.description };
  if (response.binary) {
    success.content = { [response.binary.contentType]: { schema: { type: "string", format: "binary", ...(response.binary.description ? { description: response.binary.description } : {}) } } };
  } else if (response.schema) {
    success.content = { "application/json": { schema: refTo(outputs, response.schema, `${where} response`) } };
  }

  const errorBody = { "application/json": { schema: refTo(outputs, errorResponse, "ErrorResponse") } };
  const responses: Record<string, Json> = { [String(response.status)]: success };
  for (const status of errorStatuses(operation)) {
    responses[String(status)] = { description: ERROR_DESCRIPTIONS[status] ?? "Error", content: errorBody };
  }

  return {
    operationId: operation.id,
    tags: [operation.tag],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.access === "public" ? {} : { security: [{ sessionCookie: [] }] }),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };
}

/** The OpenAPI 3.1 document of the API, built from the operation registry and the Zod schemas. */
export function buildOpenApiDocument({ serverUrl, version = "0.1.0" }: SpecOptions): Json {
  const ids = OPERATIONS.map((operation) => operation.id);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length > 0) throw new Error(`Duplicate operationId: ${duplicated.join(", ")}`);

  const paths: Record<string, Record<string, Json>> = {};
  for (const operation of OPERATIONS) {
    const path = toOpenApiPath(operation.path);
    paths[path] ??= {};
    if (operation.method in paths[path]!) throw new Error(`Duplicate operation: ${operation.method.toUpperCase()} ${path}`);
    paths[path]![operation.method] = buildOperation(operation);
  }

  return {
    openapi: "3.1.0",
    info: { title: "MyBricks API", version, description: DESCRIPTION },
    servers: [{ url: serverUrl }],
    tags: TAGS,
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description: "The session cookie set by Better Auth on sign-in. Browsers send it on their own when the request is made with credentials.",
        },
      },
      schemas: tidy(componentSchemas()),
    },
  };
}
