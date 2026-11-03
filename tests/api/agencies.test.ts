import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type Account, Session, createCast, prisma, resetDatabase } from "../helpers/world.js";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Agencies API", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let imobiliariaCentro: { id: string; name: string };
  let propertyId: string;

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("list without session -> 401", (await anon.call("GET", "/api/agencies")).status === 401);
    check("create without session -> 401", (await anon.call("POST", "/api/agencies", { name: "Imobiliária X" })).status === 401);
    ({ ana, bia, carlos } = await createCast());
  });

  it("creates agencies", async () => {
    const created = await ana.session.call("POST", "/api/agencies", { name: "  Imobiliária Centro " });
    check("create -> 201 with a trimmed name", created.status === 201 && created.json.name === "Imobiliária Centro", created);
    imobiliariaCentro = created.json;
    check("a second agency", (await ana.session.call("POST", "/api/agencies", { name: "Casa & Cia" })).status === 201);

    const duplicate = await ana.session.call("POST", "/api/agencies", { name: "Imobiliária Centro" });
    check("same name in the same organization -> 409", duplicate.status === 409 && duplicate.json?.error?.code === "CONFLICT", duplicate);
    check("same name in another organization is allowed", (await carlos.session.call("POST", "/api/agencies", { name: "Imobiliária Centro" })).status === 201);

    check("short name -> 400", (await ana.session.call("POST", "/api/agencies", { name: "A" })).status === 400);
    check("missing name -> 400", (await ana.session.call("POST", "/api/agencies", {})).status === 400);
  });

  it("lists, searches and paginates", async () => {
    const list = await ana.session.call("GET", "/api/agencies");
    check("list: 2 agencies sorted by name", list.json?.total === 2 && list.json.items[0].name === "Casa & Cia", list.json);
    check("search by name, case-insensitive", (await ana.session.call("GET", "/api/agencies?search=centro")).json?.total === 1);
    const paged = await ana.session.call("GET", "/api/agencies?page=2&pageSize=1");
    check("pagination", paged.json?.items?.length === 1 && paged.json.page === 2 && paged.json.total === 2, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/agencies?pageSize=500")).status === 400);
    check("get by id", (await ana.session.call("GET", `/api/agencies/${imobiliariaCentro.id}`)).json?.name === "Imobiliária Centro");
    check("unknown id -> 404", (await ana.session.call("GET", "/api/agencies/00000000-0000-4000-8000-000000000000")).status === 404);
    check("non-uuid id -> 400", (await ana.session.call("GET", "/api/agencies/xyz")).status === 400);
  });

  it("renames agencies", async () => {
    const renamed = await ana.session.call("PATCH", `/api/agencies/${imobiliariaCentro.id}`, { name: "Imobiliária Centro Histórico" });
    check("rename", renamed.status === 200 && renamed.json.name === "Imobiliária Centro Histórico", renamed);
    check("renaming onto another agency's name -> 409", (await ana.session.call("PATCH", `/api/agencies/${imobiliariaCentro.id}`, { name: "Casa & Cia" })).status === 409);
    check("renaming to the same name is fine", (await ana.session.call("PATCH", `/api/agencies/${imobiliariaCentro.id}`, { name: "Imobiliária Centro Histórico" })).status === 200);
    check("empty name -> 400", (await ana.session.call("PATCH", `/api/agencies/${imobiliariaCentro.id}`, { name: "" })).status === 400);
  });

  it("links an agency to a property", async () => {
    const created = await ana.session.call("POST", "/api/properties", {
      name: "Apto 1", propertyType: "residential", usageType: "rental", agencyId: imobiliariaCentro.id,
    });
    check("property created with an agency", created.status === 201 && created.json.agencyId === imobiliariaCentro.id && created.json.agencyName === "Imobiliária Centro Histórico", created);
    propertyId = created.json.id;

    const base = { name: "Apto 2", propertyType: "residential", usageType: "rental" };
    const unknown = await ana.session.call("POST", "/api/properties", { ...base, agencyId: "00000000-0000-4000-8000-000000000000" });
    check("unknown agency -> 400 with the field path", unknown.status === 400 && unknown.json.error.details.some((d: { path: string }) => d.path === "agencyId"), unknown);
    const foreign = await carlos.session.call("GET", "/api/agencies");
    const other = await ana.session.call("POST", "/api/properties", { ...base, agencyId: foreign.json.items[0].id });
    check("another organization's agency -> 400", other.status === 400, other);
    const listed = await ana.session.call("GET", "/api/properties");
    check("listing exposes the agency name", listed.json?.items?.find((p: { id: string }) => p.id === propertyId)?.agencyName === "Imobiliária Centro Histórico");
  });

  it("refuses to delete an agency that still manages properties", async () => {
    const blocked = await ana.session.call("DELETE", `/api/agencies/${imobiliariaCentro.id}`);
    check("delete with properties -> 409 with the count", blocked.status === 409 && blocked.json?.error?.details?.properties === 1, blocked);

    const detached = await ana.session.call("PATCH", `/api/properties/${propertyId}`, { agencyId: null });
    check("agency can be detached from the property", detached.json?.agencyId === null && detached.json.agencyName === null, detached);
    const deleted = await ana.session.call("DELETE", `/api/agencies/${imobiliariaCentro.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("deleted agency is gone (404)", (await ana.session.call("GET", `/api/agencies/${imobiliariaCentro.id}`)).status === 404);
    check("delete twice -> 404", (await ana.session.call("DELETE", `/api/agencies/${imobiliariaCentro.id}`)).status === 404);
  });

  it("shares agencies with the members and keeps organizations apart", async () => {
    check("a member sees the organization's agencies", (await bia.session.call("GET", "/api/agencies")).json?.total === 1);
    const biaAgency = await bia.session.call("POST", "/api/agencies", { name: "Agência da Bia" });
    check("a member can create an agency", biaAgency.status === 201, biaAgency);
    check("the owner sees it", (await ana.session.call("GET", "/api/agencies")).json?.total === 2);

    const carlosList = await carlos.session.call("GET", "/api/agencies");
    check("another organization only sees its own", carlosList.json?.total === 1, carlosList.json);
    check("other organization cannot read, rename or delete (404)",
      (await carlos.session.call("GET", `/api/agencies/${biaAgency.json.id}`)).status === 404 &&
      (await carlos.session.call("PATCH", `/api/agencies/${biaAgency.json.id}`, { name: "Hackeada" })).status === 404 &&
      (await carlos.session.call("DELETE", `/api/agencies/${biaAgency.json.id}`)).status === 404);
  });
});
