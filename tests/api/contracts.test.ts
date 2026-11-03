import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type ApiResponse, Session, prisma, resetDatabase, signUp } from "../helpers/world.js";

const CPF_1 = "529.982.247-25";
const CPF_2 = "168.995.350-09";
const CNPJ = "11.222.333/0001-81";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Contracts API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, apto: any, apto2: any, flat: any, manual: any, ownUse: any, biaProp: any, carlosProp: any, terms: any, base: any, first: any, c1: any, stay: any, retro: any, activeId: any, ended: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("sets up the scenario", async () => {
    const anon = new Session();
    check("contracts without session -> 401", (await anon.call("GET", "/api/contracts")).status === 401);
    check("occupants without session -> 401", (await anon.call("GET", "/api/occupants")).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });

    const mkProperty = async (who: typeof ana, name: string, usageType: string, rentalMode = "contract", propertyType = "residential") => {
      const r = await who.session.call("POST", "/api/properties", { name, propertyType, usageType, rentalMode });
      if (r.status !== 201) throw new Error(`property ${name}: ${JSON.stringify(r)}`);
      return r.json.id as string;
    };
    apto = await mkProperty(ana, "Apto 1", "rental");
    apto2 = await mkProperty(ana, "Apto 2", "rental");
    flat = await mkProperty(ana, "Flat Temporada", "short_stay");
    manual = await mkProperty(ana, "Casa Manual", "rental", "manual");
    ownUse = await mkProperty(ana, "Casa Própria", "own_use");
    biaProp = await mkProperty(bia, "Imóvel da Bia", "rental");
    carlosProp = await mkProperty(carlos, "Imóvel do Carlos", "rental");

    terms = { monthlyRentCents: 350_000, dueDay: 5, adjustmentIndex: "igpm" };
    base = { propertyId: apto, contractType: "conventional", startDate: "2026-01-01", rentTerms: terms, occupant: { name: "João Inquilino", document: CPF_1, email: "Joao@Example.com", phone: "(11) 91111-2222" } };
  });

  it("create", async () => {
    first = await ana.session.call("POST", "/api/contracts", base);
    check("create conventional contract -> 201", first.status === 201, first);
    c1 = first.json;
    check("status active, open-ended, dates as YYYY-MM-DD", c1?.status === "active" && c1.startDate === "2026-01-01" && c1.endDate === null, c1);
    check("rent terms as integer cents", c1?.rentTerms?.monthlyRentCents === 350_000 && c1.rentTerms.dueDay === 5 && c1.rentTerms.adjustmentIndex === "igpm", c1?.rentTerms);
    check("occupant created and normalized", c1?.occupant?.name === "João Inquilino" && c1.occupant.document === "52998224725" && c1.occupant.email === "joao@example.com" && c1.occupant.phone === "11911112222", c1?.occupant);
    check("first contract replaces nothing", c1?.replacedContractId === null && c1.propertyName === "Apto 1", c1);
    check("property becomes rented through the active contract", (await ana.session.call("GET", `/api/properties/${apto}`)).json?.status === "rented");
  });

  it("validation", async () => {
    const bad = (name: string, body: unknown, path?: string) =>
      ana.session.call("POST", "/api/contracts", body).then((r: ApiResponse) => {
        check(name, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR" && (!path || r.json.error.details.some((d: any) => d.path === path)), r);
      });
    await bad("neither occupantId nor occupant -> 400", { ...base, occupant: undefined }, "occupantId");
    await bad("both occupantId and occupant -> 400", { ...base, occupantId: c1.occupant.id }, "occupantId");
    await bad("end date not after start -> 400", { ...base, propertyId: apto2, endDate: "2026-01-01" }, "endDate");
    await bad("conventional without rent terms -> 400", { ...base, propertyId: apto2, rentTerms: undefined }, "rentTerms");
    await bad("short-stay with rent terms -> 400", { ...base, propertyId: flat, contractType: "short_stay" }, "rentTerms");
    await bad("zero rent -> 400", { ...base, propertyId: apto2, rentTerms: { ...terms, monthlyRentCents: 0 } });
    await bad("due day 32 -> 400", { ...base, propertyId: apto2, rentTerms: { ...terms, dueDay: 32 } });
    await bad("invalid occupant document -> 400", { ...base, propertyId: apto2, occupant: { name: "Fulano", document: "123.456.789-00" } });
    await bad("impossible date -> 400", { ...base, propertyId: apto2, startDate: "2026-13-40" });
    await bad("non-uuid property -> 400", { ...base, propertyId: "x" });
    await bad("unknown adjustment index -> 400", { ...base, propertyId: apto2, rentTerms: { ...terms, adjustmentIndex: "xyz" } });
    await bad("unknown occupantId -> 400", { ...base, propertyId: apto2, occupant: undefined, occupantId: "00000000-0000-4000-8000-000000000000" }, "occupantId");
    check("failed creates left nothing behind", (await prisma.contract.count()) === 1 && (await prisma.occupant.count()) === 1);
  });

  it("business rules", async () => {
    const rule = (name: string, body: unknown) =>
      ana.session.call("POST", "/api/contracts", body).then((r: ApiResponse) => {
        check(name, r.status === 422 && r.json?.error?.code === "BUSINESS_RULE_VIOLATION", r);
      });
    await rule("property in manual mode -> 422", { ...base, propertyId: manual });
    await rule("own-use property -> 422", { ...base, propertyId: ownUse });
    await rule("short-stay contract on a non short-stay property -> 422", { ...base, propertyId: apto2, contractType: "short_stay", rentTerms: undefined });
    await rule("conventional contract on a short-stay property -> 422", { ...base, propertyId: flat });
    check("unknown property -> 404", (await ana.session.call("POST", "/api/contracts", { ...base, propertyId: "00000000-0000-4000-8000-000000000000" })).status === 404);
    check("another organization's property -> 404", (await ana.session.call("POST", "/api/contracts", { ...base, propertyId: carlosProp })).status === 404);
  });

  it("short stay + occupant reuse", async () => {
    stay = await ana.session.call("POST", "/api/contracts", {
      propertyId: flat, contractType: "short_stay", startDate: "2026-02-01", endDate: "2026-12-31",
      occupant: { name: "Outro Nome", document: CPF_1 },
    });
    check("short-stay contract -> 201 without rent terms", stay.status === 201 && stay.json.rentTerms === null && stay.json.endDate === "2026-12-31", stay);
    check("same document reuses the stored occupant", stay.json?.occupant?.id === c1.occupant.id && stay.json.occupant.name === "João Inquilino", stay.json?.occupant);
    check("only one occupant row for that document", (await prisma.occupant.count({ where: { document: "52998224725" } })) === 1);
    const byId = await ana.session.call("POST", "/api/contracts", { ...base, propertyId: apto2, occupant: undefined, occupantId: c1.occupant.id });
    check("existing occupant by id -> 201", byId.status === 201 && byId.json.occupant.id === c1.occupant.id, byId);
    const company = await ana.session.call("POST", "/api/contracts", {
      propertyId: ownUse, contractType: "conventional", startDate: "2026-01-01", rentTerms: terms, occupant: { name: "Empresa", document: CNPJ },
    });
    check("(sanity) CNPJ occupant on an own-use property still -> 422", company.status === 422, company);
  });

  it("auto-close of the active contract", async () => {
    const second = await ana.session.call("POST", "/api/contracts", { ...base, startDate: "2026-06-01", rentTerms: { ...terms, monthlyRentCents: 400_000 }, occupant: { name: "Maria Nova", document: CPF_2 } });
    check("new contract on a let property -> 201 reporting the replaced one", second.status === 201 && second.json.replacedContractId === c1.id, second);
    const c1After = await ana.session.call("GET", `/api/contracts/${c1.id}`);
    check("previous contract ended and shortened to the new start", c1After.json?.status === "ended" && c1After.json.endDate === "2026-06-01", c1After.json);
    check("exactly one active contract on the property", (await prisma.contract.count({ where: { propertyId: apto, status: "active" } })) === 1);
    const third = await ana.session.call("POST", "/api/contracts", { ...base, startDate: "2026-12-01", endDate: "2027-12-01", rentTerms: { ...terms, monthlyRentCents: 450_000 }, occupant: { name: "Maria Nova", document: CPF_2 } });
    const c2After = await ana.session.call("GET", `/api/contracts/${second.json.id}`);
    check("replacing again ends the second one", third.json?.replacedContractId === second.json.id && c2After.json?.status === "ended" && c2After.json.endDate === "2026-12-01", c2After.json);
    // a contract that already ended earlier keeps its own end date
    await prisma.contract.update({ where: { id: third.json.id }, data: { endDate: new Date("2027-01-10") } });
    const fourth = await ana.session.call("POST", "/api/contracts", { ...base, startDate: "2027-03-01", occupant: { name: "Maria Nova", document: CPF_2 } });
    const c3After = await ana.session.call("GET", `/api/contracts/${third.json.id}`);
    check("an end date already before the new start is kept", fourth.status === 201 && c3After.json?.status === "ended" && c3After.json.endDate === "2027-01-10", c3After.json);
    retro = await ana.session.call("POST", "/api/contracts", { ...base, startDate: "2026-01-01", occupant: { name: "Maria Nova", document: CPF_2 } });
    const c4After = await ana.session.call("GET", `/api/contracts/${fourth.json.id}`);
    check("a retroactive contract ends the active one without moving its dates", retro.status === 201 && c4After.json?.status === "ended" && c4After.json.endDate === null && c4After.json.startDate === "2027-03-01", c4After.json);
    check("history is kept: 5 contracts on the property", (await prisma.contract.count({ where: { propertyId: apto } })) === 5);
    check("still exactly one active contract", (await prisma.contract.count({ where: { propertyId: apto, status: "active" } })) === 1);
  });

  it("concurrent creates never leave two active contracts", async () => {
    const racers = await Promise.all([1, 2].map((n) =>
      ana.session.call("POST", "/api/contracts", { ...base, propertyId: apto2, startDate: `2026-0${n + 6}-01`, occupant: { name: "Maria Nova", document: CPF_2 } })));
    check("concurrent creates: statuses are 201 or 409", racers.every((r) => r.status === 201 || r.status === 409), racers.map((r) => r.status));
    check("concurrent creates: at least one wins", racers.some((r) => r.status === 201));
    check("concurrent creates: still one active contract", (await prisma.contract.count({ where: { propertyId: apto2, status: "active" } })) === 1);
  });

  it("list / get", async () => {
    const list = await ana.session.call("GET", `/api/contracts?propertyId=${apto}`);
    check("list by property, newest start first", list.json?.total === 5 && list.json.items[0].startDate === "2027-03-01" && list.json.items.at(-1).startDate === "2026-01-01", list.json?.items?.map((i: any) => i.startDate));
    check("filter by status", (await ana.session.call("GET", `/api/contracts?propertyId=${apto}&status=active`)).json?.total === 1);
    check("filter by type", (await ana.session.call("GET", "/api/contracts?contractType=short_stay")).json?.total === 1);
    const paged = await ana.session.call("GET", `/api/contracts?propertyId=${apto}&page=2&pageSize=2`);
    check("pagination", paged.json?.items?.length === 2 && paged.json.total === 5 && paged.json.page === 2, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/contracts?pageSize=500")).status === 400);
    check("get by id", (await ana.session.call("GET", `/api/contracts/${stay.json.id}`)).json?.id === stay.json.id);
    check("unknown id -> 404", (await ana.session.call("GET", "/api/contracts/00000000-0000-4000-8000-000000000000")).status === 404);
  });

  it("patch", async () => {
    activeId = retro.json.id as string;
    const patched = await ana.session.call("PATCH", `/api/contracts/${activeId}`, { notes: "Reajuste anual", endDate: "2027-12-31", rentTerms: { monthlyRentCents: 380_000, adjustmentIndex: null } });
    check("patch notes, end date and part of the rent terms", patched.status === 200 && patched.json.notes === "Reajuste anual" && patched.json.endDate === "2027-12-31" && patched.json.rentTerms.monthlyRentCents === 380_000 && patched.json.rentTerms.adjustmentIndex === null && patched.json.rentTerms.dueDay === 5, patched);
    check("clearing the end date", (await ana.session.call("PATCH", `/api/contracts/${activeId}`, { endDate: null })).json?.endDate === null);
    check("empty patch -> 400", (await ana.session.call("PATCH", `/api/contracts/${activeId}`, {})).status === 400);
    check("end date before start -> 400", (await ana.session.call("PATCH", `/api/contracts/${activeId}`, { endDate: "2025-12-31" })).status === 400);
    check("zero rent -> 400", (await ana.session.call("PATCH", `/api/contracts/${activeId}`, { rentTerms: { monthlyRentCents: 0 } })).status === 400);
    check("rent terms on a short-stay contract -> 400", (await ana.session.call("PATCH", `/api/contracts/${stay.json.id}`, { rentTerms: { dueDay: 3 } })).status === 400);
    check("ended contracts are read-only (422)", (await ana.session.call("PATCH", `/api/contracts/${c1.id}`, { notes: "x" })).status === 422);
  });

  it("end / cancel", async () => {
    ended = await ana.session.call("POST", `/api/contracts/${activeId}/end`, { endDate: "2026-09-30" });
    check("end with a date", ended.status === 200 && ended.json.status === "ended" && ended.json.endDate === "2026-09-30", ended);
    check("property is vacant again after the last contract ends", (await ana.session.call("GET", `/api/properties/${apto}`)).json?.status === "vacant");
    check("ending twice -> 422", (await ana.session.call("POST", `/api/contracts/${activeId}/end`, {})).status === 422);
    check("cancelling an ended contract -> 422", (await ana.session.call("POST", `/api/contracts/${activeId}/cancel`)).status === 422);
    const stayEnd = await ana.session.call("POST", `/api/contracts/${stay.json.id}/end`, { endDate: "2026-02-01" });
    check("end date not after start -> 400", stayEnd.status === 400, stayEnd);
    const stayEnded = await ana.session.call("POST", `/api/contracts/${stay.json.id}/end`, {});
    check("end without a date keeps the planned end", stayEnded.json?.status === "ended" && stayEnded.json.endDate === "2026-12-31", stayEnded);
    const reopen = await ana.session.call("POST", "/api/contracts", { ...base, startDate: "2027-01-01" });
    check("a new contract after the last one ended replaces nothing", reopen.status === 201 && reopen.json.replacedContractId === null, reopen);
    const cancelled = await ana.session.call("POST", `/api/contracts/${reopen.json.id}/cancel`);
    check("cancel -> status cancelled", cancelled.status === 200 && cancelled.json.status === "cancelled", cancelled);
    check("cancelled contract cannot be ended (422)", (await ana.session.call("POST", `/api/contracts/${reopen.json.id}/end`, {})).status === 422);
    check("contracts cannot be deleted", (await ana.session.call("DELETE", `/api/contracts/${reopen.json.id}`)).status === 404);
    check("malformed id on end -> 400", (await ana.session.call("POST", "/api/contracts/xyz/end", {})).status === 400);
  });

  it("members and occupants", async () => {
    const biaContract = await bia.session.call("POST", "/api/contracts", { ...base, propertyId: biaProp, occupant: { name: "Inquilina da Bia", document: CNPJ } });
    check("member creates a contract on her property", biaContract.status === 201, biaContract);
    check("member cannot create on another member's property (404)", (await bia.session.call("POST", "/api/contracts", { ...base, propertyId: apto2, occupant: { name: "Teste Bia" } })).status === 404);
    const biaList = await bia.session.call("GET", "/api/contracts");
    check("member lists only contracts of her properties", biaList.json?.total === 1 && biaList.json.items[0].id === biaContract.json.id, biaList.json);
    check("member cannot read another member's contract (404)", (await bia.session.call("GET", `/api/contracts/${c1.id}`)).status === 404);
    check("member cannot update, end or cancel it (404)",
      (await bia.session.call("PATCH", `/api/contracts/${activeId}`, { notes: "x" })).status === 404 &&
      (await bia.session.call("POST", `/api/contracts/${stay.json.id}/end`, {})).status === 404 &&
      (await bia.session.call("POST", `/api/contracts/${stay.json.id}/cancel`)).status === 404);
    const biaOccupants = await bia.session.call("GET", "/api/occupants");
    check("member sees only occupants of her contracts", biaOccupants.json?.total === 1 && biaOccupants.json.items[0].name === "Inquilina da Bia", biaOccupants.json);
    const anaOccupants = await ana.session.call("GET", "/api/occupants");
    check("owner sees every occupant of the organization", anaOccupants.json?.total === 3, anaOccupants.json);
    check("occupant search by name", (await ana.session.call("GET", "/api/occupants?search=maria")).json?.total === 1);
    check("occupant search by document digits", (await ana.session.call("GET", "/api/occupants?search=5299822")).json?.total === 1);
    check("occupant pagination", (await ana.session.call("GET", "/api/occupants?page=2&pageSize=2")).json?.items?.length === 1);
    check("owner sees all contracts", (await ana.session.call("GET", "/api/contracts?pageSize=100")).json?.total === (await prisma.contract.count({ where: { organizationId: ana.organizationId } })));
  });

  it("tenant isolation", async () => {
    check("other organization cannot read (404)", (await carlos.session.call("GET", `/api/contracts/${c1.id}`)).status === 404);
    check("other organization cannot update, end or cancel (404)",
      (await carlos.session.call("PATCH", `/api/contracts/${c1.id}`, { notes: "x" })).status === 404 &&
      (await carlos.session.call("POST", `/api/contracts/${stay.json.id}/end`, {})).status === 404 &&
      (await carlos.session.call("POST", `/api/contracts/${stay.json.id}/cancel`)).status === 404);
    check("other organization lists nothing of ours", (await carlos.session.call("GET", "/api/contracts")).json?.total === 0 && (await carlos.session.call("GET", "/api/occupants")).json?.total === 0);
    const foreignOccupant = await carlos.session.call("POST", "/api/contracts", { ...base, propertyId: carlosProp, occupant: undefined, occupantId: c1.occupant.id });
    check("cannot reuse another organization's occupant by id (400)", foreignOccupant.status === 400, foreignOccupant);
    const sameDocElsewhere = await carlos.session.call("POST", "/api/contracts", { ...base, propertyId: carlosProp, occupant: { name: "Outro João", document: CPF_1 } });
    check("same document in another organization creates its own occupant", sameDocElsewhere.status === 201 && sameDocElsewhere.json.occupant.id !== c1.occupant.id, sameDocElsewhere);
  });

  it("property deletion removes its contracts (explicit, destructive)", async () => {
    check("deleting the property removes the contracts", (await ana.session.call("DELETE", `/api/properties/${apto2}`)).status === 204 && (await prisma.contract.count({ where: { propertyId: apto2 } })) === 0);
  });
});
