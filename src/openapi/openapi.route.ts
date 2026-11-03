import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { buildOpenApiDocument } from "./spec.js";

export interface OpenApiRoutesOptions {
  /** Where the API is reachable; written into the `servers` of the document. */
  serverUrl: string;
}

/**
 * Route layer: the machine-readable description of the API and a page to read it.
 * Mounted under `/api`; both are public (they describe the API, they expose no data).
 * The document is built once at start-up, so an inconsistent operation registry stops the server
 * from starting instead of failing on the first request.
 */
export function createOpenApiRoutes({ serverUrl }: OpenApiRoutesOptions) {
  const document = buildOpenApiDocument({ serverUrl });

  return new Hono()
    .get("/openapi.json", (c) => c.json(document))
    .get("/docs", Scalar({ url: "/api/openapi.json", pageTitle: "MyBricks API" }));
}
