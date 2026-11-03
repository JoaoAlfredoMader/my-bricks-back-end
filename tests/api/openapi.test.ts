import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { validate } from "@scalar/openapi-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContainer } from "../../src/container.js";
import { ensurePlatformAdmin } from "../../src/modules/auth/platform-admin.js";
import { OPERATIONS, TAGS } from "../../src/openapi/routes.js";
import type { Operation } from "../../src/openapi/operations.js";
import { errorResponse } from "../../src/openapi/schemas/common.js";
import { buildOpenApiDocument } from "../../src/openapi/spec.js";
import { check } from "../helpers/check.js";
import { HTML_AS_IMAGE, MIME, PDF, PNG } from "../helpers/fixtures.js";
import { type ApiResponse, Session, app, env, prisma, resetDatabase } from "../helpers/world.js";

const document = buildOpenApiDocument({ serverUrl: "http://localhost:3000" }) as {
  openapi: string;
  paths: Record<string, Record<string, { operationId: string; tags: string[]; summary: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown> };
};

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("The OpenAPI document", () => {
  it("is valid OpenAPI 3.1", async () => {
    const result = await validate(document);
    expect(result.errors ?? [], JSON.stringify(result.errors?.slice(0, 3))).toEqual([]);
    expect(result.valid).toBe(true);
    expect(document.openapi).toBe("3.1.0");
  });

  it("describes exactly the routes the app registers, in both directions", () => {
    const registered = new Set(
      app.routes
        .filter((route) => route.method !== "ALL")
        // Better Auth answers /api/auth/* itself and documents it in its own reference; the two routes below describe the API.
        .filter((route) => !route.path.startsWith("/api/auth/") && route.path !== "/api/openapi.json" && route.path !== "/api/docs")
        .map((route) => `${route.method} ${route.path}`),
    );
    const described = new Set(OPERATIONS.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`));

    const undocumented = [...registered].filter((route) => !described.has(route));
    const imaginary = [...described].filter((route) => !registered.has(route));
    expect(undocumented, "routes without an operation in src/openapi/routes.ts").toEqual([]);
    expect(imaginary, "operations for routes that do not exist").toEqual([]);
  });

  it("gives every operation a unique id, a summary and a known tag, and uses every tag", () => {
    const ids = OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tags = new Set(TAGS.map((tag) => tag.name));
    for (const operation of OPERATIONS) {
      expect(operation.summary.length, operation.id).toBeGreaterThan(5);
      expect(tags.has(operation.tag), `${operation.id}: tag ${operation.tag}`).toBe(true);
    }
    for (const tag of tags) expect(OPERATIONS.some((operation) => operation.tag === tag), `unused tag ${tag}`).toBe(true);
  });

  it("only points to components that exist", () => {
    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z]+)"/g)].map((match) => match[1]!);
    expect(refs.length).toBeGreaterThan(100);
    for (const name of new Set(refs)) expect(document.components.schemas, name).toHaveProperty(name);
  });

  it("separates what is asked from what is answered", () => {
    const names = Object.keys(document.components.schemas);
    const requests = names.filter((name) => name.endsWith("Request"));
    expect(requests.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain("Property");
    expect(names).toContain("ErrorResponse");
    expect(JSON.stringify(document.components.schemas.CreateClientRequest)).toContain('"default":"individual"');
  });

  it("every operation documents the errors it can answer", () => {
    for (const operation of OPERATIONS) {
      const path = operation.path.replace(/:([A-Za-z]+)/g, "{$1}");
      const responses = Object.keys(document.paths[path]![operation.method]!.responses);
      if (operation.access !== "public") expect(responses, operation.id).toContain("401");
      if (operation.access === "owner-admin" || operation.access === "platform-admin") expect(responses, operation.id).toContain("403");
      if (operation.params || operation.query || operation.body || operation.upload) expect(responses, operation.id).toContain("400");
      if (operation.path.includes(":")) expect(responses, operation.id).toContain("404");
    }
  });

  it("marks the public endpoints as not needing the session", () => {
    const security = (id: string) => (document.paths as Record<string, Record<string, { operationId: string; security?: unknown }>>);
    const find = (id: string) => Object.values(security(id)).flatMap((path) => Object.values(path)).find((operation) => operation.operationId === id)!;
    expect(find("getHealth").security).toBeUndefined();
    expect(find("listClients").security).toEqual([{ sessionCookie: [] }]);
  });

  it("the committed docs/openapi.json is the current one: run `npm run openapi:export`", () => {
    const committed = JSON.parse(readFileSync("docs/openapi.json", "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it("is served, together with the reference page", async () => {
    const json = await app.request("/api/openapi.json");
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toContain("application/json");
    const served = (await json.json()) as { openapi: string; servers: { url: string }[]; paths: object };
    expect(served.openapi).toBe("3.1.0");
    expect(served.servers[0]!.url).toBe(env.BETTER_AUTH_URL);
    expect(Object.keys(served.paths).length).toBe(Object.keys(document.paths).length);

    const docs = await app.request("/api/docs");
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("/api/openapi.json");

    expect((await app.request("/api/auth/reference")).status).toBe(200);
  });

  it("refuses to build when the registry disagrees with itself", async () => {
    const specModule = await import("../../src/openapi/spec.js");
    const routes = await import("../../src/openapi/routes.js");
    const original = [...routes.OPERATIONS];
    const clone = original.find((operation) => operation.id === "getClient")!;

    (routes.OPERATIONS as Operation[]).push({ ...clone }); // same operationId again
    expect(() => specModule.buildOpenApiDocument({ serverUrl: "http://x" })).toThrow(/Duplicate operationId/);
    (routes.OPERATIONS as Operation[]).pop();

    (routes.OPERATIONS as Operation[]).push({ ...clone, id: "other", path: "/api/clients/:identifier" }); // the schema says `id`
    expect(() => specModule.buildOpenApiDocument({ serverUrl: "http://x" })).toThrow(/has parameters \[identifier\]/);
    (routes.OPERATIONS as Operation[]).pop();

    expect(routes.OPERATIONS.length).toBe(original.length);
  });
});

/**
 * Calls the real API and checks every answer against the document: the status must be documented,
 * and the body must parse with the response schema with nothing extra and nothing missing.
 */
describe("The API answers what the document promises", () => {
  const demo = createContainer(env);
  const touched = new Set<string>();
  let guest: Session;
  let admin: Session;
  let property: { id: string; [key: string]: unknown };

  const pathMatchers = OPERATIONS.map((operation) => ({
    operation,
    pattern: new RegExp(`^${operation.path.replace(/:[A-Za-z]+/g, "[^/]+")}$`),
  }));
  const find = (method: string, path: string): Operation | undefined =>
    pathMatchers.find((entry) => entry.operation.method === method.toLowerCase() && entry.pattern.test(path))?.operation;

  /** Makes a call and checks the answer against the document. */
  async function api(session: Session, method: string, url: string, body?: unknown): Promise<ApiResponse> {
    const response = await session.call(method, url, body);
    verify(method, url, response.status, response.json);
    return response;
  }

  function verify(method: string, url: string, status: number, json: unknown) {
    const path = url.split("?")[0]!;
    const operation = find(method, path);
    check(`${method} ${path} is a documented operation`, operation !== undefined);
    if (!operation) return;
    touched.add(operation.id);

    const openApiPath = operation.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const documented = document.paths[openApiPath]![operation.method]!.responses;
    check(`${method} ${path} -> ${status} is documented`, String(status) in documented, Object.keys(documented));

    if (status === operation.response.status && operation.response.schema) {
      const parsed = operation.response.schema.safeParse(json);
      check(`${operation.id}: the ${status} body matches its schema`, parsed.success, parsed.success ? undefined : parsed.error.issues.slice(0, 3));
      // Parsing strips what the schema does not know: if anything differs, the response has an undocumented field.
      if (parsed.success) check(`${operation.id}: the ${status} body has nothing the schema does not describe`, isDeepStrictEqual(parsed.data, json), parsed.data);
    } else if (status >= 400 && json) {
      const parsed = errorResponse.safeParse(json);
      check(`${operation.id}: the ${status} body is an ErrorResponse`, parsed.success, json);
    }
  }

  /** A binary answer: only the status is checked. */
  async function download(session: Session, url: string, expectedType: string) {
    const response = await session.download(url);
    const operation = find("GET", url)!;
    touched.add(operation.id);
    check(`${operation.id}: ${response.status} with the documented type`, response.status === 200 && (response.headers.get("content-type") ?? "").startsWith(expectedType), response.headers.get("content-type"));
    return response;
  }

  async function upload(session: Session, url: string, file: Parameters<Session["upload"]>[1], fields?: Record<string, string>) {
    const response = await session.upload(url, file, fields);
    verify("POST", url, response.status, response.json);
    return response;
  }

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await demo.prisma.$disconnect();
    await prisma.$disconnect();
  });

  it("signs in a guest with the sample portfolio and the platform admin", async () => {
    guest = new Session(demo.app);
    await guest.call("POST", "/api/auth/sign-in/anonymous");
    await ensurePlatformAdmin({ auth: demo.auth, prisma: demo.prisma }, { email: "operador@example.com", name: "Operador", password: "senha-do-operador-1" });
    admin = new Session(demo.app);
    await admin.call("POST", "/api/auth/sign-in/email", { email: "operador@example.com", password: "senha-do-operador-1" });

    check("health", (await api(new Session(demo.app), "GET", "/health")).status === 200);
    const me = await api(guest, "GET", "/api/me");
    check("the session says it is a guest", me.json?.user?.isAnonymous === true);
    check("unauthenticated answers are documented too", (await api(new Session(demo.app), "GET", "/api/properties")).status === 401);
  });

  it("reference data", async () => {
    await api(guest, "GET", "/api/lookups/cities?search=campinas");
    await api(guest, "GET", "/api/lookups/property-catalog");
    await api(guest, "GET", "/api/lookups/transaction-categories");
    check("an invalid search is a documented 400", (await api(guest, "GET", "/api/lookups/cities?search=c")).status === 400);
  });

  it("clients and agencies", async () => {
    const list = await api(guest, "GET", "/api/clients");
    const client = await api(guest, "POST", "/api/clients", { name: "Cliente do Contrato", document: "390.533.447-05" });
    await api(guest, "GET", `/api/clients/${client.json.id}`);
    await api(guest, "PATCH", `/api/clients/${client.json.id}`, { email: "novo@example.com" });
    check("a duplicate document is a documented 409", (await api(guest, "POST", "/api/clients", { name: "Outro", document: "390.533.447-05" })).status === 409);
    check("an invalid body is a documented 400", (await api(guest, "POST", "/api/clients", { name: "A" })).status === 400);
    check("an unknown client is a documented 404", (await api(guest, "GET", `/api/clients/${UNKNOWN}`)).status === 404);
    check("a client that owns properties cannot be deleted (documented 409)", (await api(guest, "DELETE", `/api/clients/${list.json.items[0].id}`)).status === 409);
    check("a client without properties can", (await api(guest, "DELETE", `/api/clients/${client.json.id}`)).status === 204);

    await api(guest, "GET", "/api/agencies");
    const agency = await api(guest, "POST", "/api/agencies", { name: "Imobiliária Nova" });
    await api(guest, "GET", `/api/agencies/${agency.json.id}`);
    await api(guest, "PATCH", `/api/agencies/${agency.json.id}`, { name: "Imobiliária Novíssima" });
    check("a duplicate agency name is a documented 409", (await api(guest, "POST", "/api/agencies", { name: "Imobiliária Central" })).status === 409);
    check("an agency without properties can be deleted", (await api(guest, "DELETE", `/api/agencies/${agency.json.id}`)).status === 204);
  });

  it("properties, proposals and indicators", async () => {
    const list = await api(guest, "GET", "/api/properties?pageSize=100");
    check("the sample portfolio is there", list.json?.total === 9, list.json?.total);
    const centro = list.json.items.find((p: { name: string }) => p.name === "Apartamento Centro");
    await api(guest, "GET", `/api/properties/${centro.id}`);
    await api(guest, "GET", `/api/properties/${centro.id}/financing-schedule`);

    const created = await api(guest, "POST", "/api/properties", { name: "Casa Nova", propertyType: "residential", usageType: "rental", rentalMode: "contract", address: { cityId: centro.address.cityId, street: "Rua A" }, acquisition: { acquisitionType: "purchase", acquiredOn: "2024-01-10", costCents: 30_000_000 }, insurance: { description: "Apólice" }, legalRecord: {} });
    property = created.json;
    await api(guest, "PATCH", `/api/properties/${property.id}`, { notes: "Teste" });
    check("a property rule is a documented 400", (await api(guest, "POST", "/api/properties", { name: "Ruim", propertyType: "land", usageType: "short_stay" })).status === 400);

    await api(guest, "GET", `/api/properties/${centro.id}/proposals`);
    const proposal = await api(guest, "POST", `/api/properties/${property.id}/proposals`, { proposalType: "sale", amountCents: 100, proposalDate: "2026-05-01" });
    await api(guest, "GET", `/api/properties/${property.id}/proposals/${proposal.json.id}`);
    await api(guest, "PATCH", `/api/properties/${property.id}/proposals/${proposal.json.id}`, { amountCents: 200 });
    await api(guest, "DELETE", `/api/properties/${property.id}/proposals/${proposal.json.id}`);

    const portfolio = await api(guest, "GET", "/api/kpis/portfolio");
    await api(guest, "GET", `/api/kpis/properties/${centro.id}`);
    check("the portfolio indicators cover every property", portfolio.json?.propertyCount === 10, portfolio.json?.propertyCount);
  });

  it("contracts, occupants and the template", async () => {
    await api(guest, "GET", "/api/occupants");
    await api(guest, "GET", "/api/contracts");
    const contract = await api(guest, "POST", "/api/contracts", { propertyId: property.id, contractType: "conventional", startDate: "2026-01-01", rentTerms: { monthlyRentCents: 300_000, dueDay: 5, adjustmentIndex: "ipca" }, occupant: { name: "Inquilino do Teste" } });
    await api(guest, "GET", `/api/contracts/${contract.json.id}`);
    await api(guest, "PATCH", `/api/contracts/${contract.json.id}`, { notes: "Anotação" });
    const pdf = await api(guest, "POST", `/api/contracts/${contract.json.id}/pdf`);
    await download(guest, pdf.json.url, "application/pdf");

    const replaced = await api(guest, "POST", "/api/contracts", { propertyId: property.id, contractType: "conventional", startDate: "2026-06-01", rentTerms: { monthlyRentCents: 320_000, dueDay: 5 }, occupant: { name: "Outro Inquilino" } });
    check("the replacement says which contract it replaced", replaced.json?.replacedContractId === contract.json.id);
    await api(guest, "POST", `/api/contracts/${replaced.json.id}/end`, {});
    check("ending twice is a documented 422", (await api(guest, "POST", `/api/contracts/${replaced.json.id}/end`, {})).status === 422);
    const third = await api(guest, "POST", "/api/contracts", { propertyId: property.id, contractType: "conventional", startDate: "2026-09-01", rentTerms: { monthlyRentCents: 330_000, dueDay: 5 }, occupant: { name: "Terceiro" } });
    await api(guest, "POST", `/api/contracts/${third.json.id}/cancel`);

    const template = await api(guest, "GET", "/api/contract-template");
    await api(guest, "PUT", "/api/contract-template", { header: "<h1>MEU CONTRATO</h1>", clauses: "<p>{{locatario}}</p>", footer: "" });
    await api(guest, "DELETE", "/api/contract-template");
    check("the default template is documented as such", template.json?.isDefault === true);
    check("a PDF that was not generated is a documented 404", (await api(guest, "GET", `/api/contracts/${third.json.id}/pdf`)).status === 404);
  });

  it("reservations and transactions", async () => {
    const flat = (await api(guest, "GET", "/api/properties?search=Flat")).json.items[0];
    await api(guest, "GET", "/api/reservations");
    const reservation = await api(guest, "POST", "/api/reservations", { propertyId: flat.id, checkIn: "2027-03-10", checkOut: "2027-03-14", totalAmountCents: 100_000, occupant: { name: "Hóspede do Teste" } });
    await api(guest, "GET", `/api/reservations/${reservation.json.id}`);
    await api(guest, "PATCH", `/api/reservations/${reservation.json.id}`, { notes: "Chega tarde" });
    check("an overlap is a documented 409", (await api(guest, "POST", "/api/reservations", { propertyId: flat.id, checkIn: "2027-03-12", checkOut: "2027-03-16", occupant: { name: "Outro" } })).status === 409);
    await api(guest, "POST", `/api/reservations/${reservation.json.id}/cancel`);

    await api(guest, "GET", "/api/transactions");
    const category = (await api(guest, "GET", "/api/lookups/transaction-categories")).json[0].id;
    const transaction = await api(guest, "POST", "/api/transactions", { propertyId: property.id, categoryId: category, amountCents: 1000, occurredOn: "2026-05-10" });
    await api(guest, "GET", `/api/transactions/${transaction.json.id}`);
    await api(guest, "PATCH", `/api/transactions/${transaction.json.id}`, { amountCents: 2000 });
    await api(guest, "DELETE", `/api/transactions/${transaction.json.id}`);
  });

  it("photos and documents", async () => {
    const url = (kind: string) => `/api/properties/${property.id}/${kind}`;
    const photo = await upload(guest, url("photos"), { name: "a.png", type: MIME.png, bytes: PNG });
    const second = await upload(guest, url("photos"), { name: "b.png", type: MIME.png, bytes: PNG });
    await api(guest, "GET", url("photos"));
    await api(guest, "PUT", `${url("photos")}/order`, { photoIds: [second.json.id, photo.json.id] });
    await download(guest, photo.json.contentUrl, "image/png");
    check("a script as a photo is a documented 415", (await upload(guest, url("photos"), { name: "a.png", type: MIME.png, bytes: HTML_AS_IMAGE })).status === 415);
    check("a file over the limit is a documented 413", (await upload(guest, url("photos"), { name: "big.png", type: MIME.png, bytes: Buffer.concat([PNG, Buffer.alloc(env.MAX_UPLOAD_MB * 1024 * 1024 + 10)]) })).status === 413);
    await api(guest, "DELETE", `${url("photos")}/${photo.json.id}`);

    const document = await upload(guest, url("documents"), { name: "escritura.pdf", type: MIME.pdf, bytes: PDF }, { category: "escritura" });
    await api(guest, "GET", url("documents"));
    await api(guest, "PATCH", `${url("documents")}/${document.json.id}`, { category: "registro" });
    await download(guest, document.json.contentUrl, "application/pdf");
    await api(guest, "DELETE", `${url("documents")}/${document.json.id}`);
  });

  it("feedback, the audit trail and the platform admin", async () => {
    const sent = await api(guest, "POST", "/api/feedback", { message: "Ótimo painel de indicadores!" });
    await api(guest, "GET", "/api/feedback");
    const audit = await api(guest, "GET", "/api/audit-logs?pageSize=100");
    check("the guest, owner of the demo organization, reads its trail", audit.status === 200 && audit.json.total > 10, audit.json?.total);

    check("a normal user on the operator panel is a documented 403", (await api(guest, "GET", "/api/admin/feedback")).status === 403);
    await api(admin, "GET", "/api/admin/feedback");
    await api(admin, "PATCH", `/api/admin/feedback/${sent.json.id}`, { status: "resolved" });
    await api(admin, "GET", "/api/admin/audit-logs?pageSize=20");
  });

  it("deletes what it created, and every operation of the document was exercised", async () => {
    await api(guest, "DELETE", `/api/properties/${property.id}`);

    const never = OPERATIONS.filter((operation) => !touched.has(operation.id)).map((operation) => operation.id);
    check("every operation of the document was called and checked against its schema", never.length === 0, never);
  });
});
