import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "../openapi/spec.js";

/**
 * Writes the OpenAPI document to `docs/openapi.json`, so the front-end can generate its client
 * from a file in the repository (and a test notices when it is stale): `npm run openapi:export`.
 */
const target = resolve(process.argv[2] ?? "docs/openapi.json");
const document = buildOpenApiDocument({ serverUrl: "http://localhost:3000" });

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI document written to ${target}`);
