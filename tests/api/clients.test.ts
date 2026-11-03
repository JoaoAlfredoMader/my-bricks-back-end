import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { Session, prisma, resetDatabase, signUp } from "../helpers/world.js";

const CPF_1 = "529.982.247-25";
const CPF_2 = "168.995.350-09";
const CNPJ = "11.222.333/0001-81";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Clients API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, maria: any, company: any, list: any, missing: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("unauthenticated", async () => {
    const anon = new Session();
    check("list without session -> 401", (await anon.call("GET", "/api/clients")).status === 401);
    check("create without session -> 401", (await anon.call("POST", "/api/clients", { name: "X Y" })).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");

    // Bia becomes a plain member of Ana's organization (drops her own personal one as active).
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    const setActive = await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });
    check("member can activate the organization", setActive.status === 200, setActive);
    const meBia = await bia.session.call("GET", "/api/me");
    check("Bia is a member of Ana's organization", meBia.json?.organizationId === ana.organizationId && meBia.json?.memberRole === "member", meBia.json);
  });

  it("create", async () => {
    const created = await ana.session.call("POST", "/api/clients", {
      name: "  Maria Oliveira ", document: CPF_1, email: "Maria@Example.COM", whatsapp: "(11) 98888-7777",
    });
    check("create individual -> 201", created.status === 201, created);
    maria = created.json;
    check("document normalized to digits", maria?.document === "52998224725", maria);
    check("email lowercased, name trimmed", maria?.email === "maria@example.com" && maria?.name === "Maria Oliveira", maria);
    check("whatsapp digits only", maria?.whatsapp === "11988887777", maria);
    check("personType defaults to individual", maria?.personType === "individual", maria);
    check("authorship is the caller", maria?.createdById === ana.userId, maria);
    const row = await prisma.client.findUnique({ where: { id: maria.id } });
    check("stored in the caller's organization", row?.organizationId === ana.organizationId, row);

    const blank = await ana.session.call("POST", "/api/clients", { name: "Sem Contato", document: "", email: " ", whatsapp: "" });
    check("blank optional fields become null", blank.status === 201 && blank.json.document === null && blank.json.email === null && blank.json.whatsapp === null, blank);

    company = await ana.session.call("POST", "/api/clients", { name: "Construtora ABC", personType: "company", document: CNPJ });
    check("create company with valid CNPJ -> 201", company.status === 201 && company.json.document === "11222333000181", company);
  });

  it("validation", async () => {
    const badCpf = await ana.session.call("POST", "/api/clients", { name: "Fulano", document: "529.982.247-24" });
    check("invalid CPF -> 400 VALIDATION_ERROR", badCpf.status === 400 && badCpf.json?.error?.code === "VALIDATION_ERROR", badCpf);
    const cpfOnCompany = await ana.session.call("POST", "/api/clients", { name: "Fulano Ltda", personType: "company", document: CPF_2 });
    check("CPF on a company -> 400", cpfOnCompany.status === 400, cpfOnCompany);
    const shortName = await ana.session.call("POST", "/api/clients", { name: "A" });
    check("short name -> 400 with field path", shortName.status === 400 && shortName.json?.error?.details?.[0]?.path === "name", shortName);
    const badEmail = await ana.session.call("POST", "/api/clients", { name: "Fulano", email: "nope" });
    check("invalid e-mail -> 400", badEmail.status === 400, badEmail);
    const badPhone = await ana.session.call("POST", "/api/clients", { name: "Fulano", whatsapp: "123" });
    check("invalid phone -> 400", badPhone.status === 400, badPhone);
    const badType = await ana.session.call("POST", "/api/clients", { name: "Fulano", personType: "alien" });
    check("unknown personType -> 400", badType.status === 400, badType);
    const malformed = await ana.session.call("POST", "/api/clients", undefined, "{not json");
    check("malformed JSON -> 400, not 500", malformed.status === 400, malformed);
    const badId = await ana.session.call("GET", "/api/clients/not-a-uuid");
    check("non-uuid id -> 400", badId.status === 400, badId);
  });

  it("uniqueness", async () => {
    const dup = await ana.session.call("POST", "/api/clients", { name: "Outra Maria", document: CPF_1 });
    check("duplicate document in the same organization -> 409", dup.status === 409 && dup.json?.error?.code === "CONFLICT", dup);
    const sameDocOtherOrg = await carlos.session.call("POST", "/api/clients", { name: "Maria do Carlos", document: CPF_1 });
    check("same document in another organization is allowed", sameDocOtherOrg.status === 201, sameDocOtherOrg);
  });

  it("list / search / pagination", async () => {
    list = await ana.session.call("GET", "/api/clients");
    check("list -> 200 with 3 clients sorted by name", list.status === 200 && list.json.total === 3 && list.json.items.map((i: any) => i.name).join("|") === "Construtora ABC|Maria Oliveira|Sem Contato", list.json);
    const byName = await ana.session.call("GET", "/api/clients?search=maria");
    check("search by name is case-insensitive", byName.json?.total === 1 && byName.json.items[0].id === maria.id, byName.json);
    const byDoc = await ana.session.call("GET", "/api/clients?search=11.222");
    check("search by document ignores nothing it should not (formatted input finds nothing)", byDoc.status === 200, byDoc.json);
    const byDocDigits = await ana.session.call("GET", "/api/clients?search=112223");
    check("search by document digits", byDocDigits.json?.total === 1 && byDocDigits.json.items[0].name === "Construtora ABC", byDocDigits.json);
    const byType = await ana.session.call("GET", "/api/clients?personType=company");
    check("filter by personType", byType.json?.total === 1, byType.json);
    const paged = await ana.session.call("GET", "/api/clients?page=2&pageSize=2");
    check("pagination: page 2 of size 2 has 1 item, total 3", paged.json?.items?.length === 1 && paged.json.total === 3 && paged.json.page === 2, paged.json);
    const badPage = await ana.session.call("GET", "/api/clients?pageSize=1000");
    check("pageSize above the cap -> 400", badPage.status === 400, badPage);
  });

  it("get / patch", async () => {
    const got = await ana.session.call("GET", `/api/clients/${maria.id}`);
    check("get by id -> 200", got.status === 200 && got.json.id === maria.id, got);
    missing = await ana.session.call("GET", "/api/clients/00000000-0000-4000-8000-000000000000");
    check("unknown id -> 404", missing.status === 404 && missing.json?.error?.code === "NOT_FOUND", missing);

    const patched = await ana.session.call("PATCH", `/api/clients/${maria.id}`, { name: "Maria O. Santos", email: null });
    check("patch name and clear email", patched.status === 200 && patched.json.name === "Maria O. Santos" && patched.json.email === null && patched.json.document === "52998224725", patched);
    check("patch moves updatedAt forward", new Date(patched.json.updatedAt) >= new Date(maria.updatedAt));
    const emptyPatch = await ana.session.call("PATCH", `/api/clients/${maria.id}`, {});
    check("empty patch -> 400", emptyPatch.status === 400, emptyPatch);
    const typeSwitch = await ana.session.call("PATCH", `/api/clients/${maria.id}`, { personType: "company" });
    check("switching to company while holding a CPF -> 400", typeSwitch.status === 400, typeSwitch);
    const typeAndDoc = await ana.session.call("PATCH", `/api/clients/${maria.id}`, { personType: "company", document: CNPJ });
    check("changing to a document already used -> 409", typeAndDoc.status === 409, typeAndDoc);
    const clearDoc = await ana.session.call("PATCH", `/api/clients/${maria.id}`, { document: null });
    check("document can be cleared", clearDoc.status === 200 && clearDoc.json.document === null, clearDoc);
    const restoreDoc = await ana.session.call("PATCH", `/api/clients/${maria.id}`, { document: CPF_1 });
    check("document can be set again", restoreDoc.status === 200 && restoreDoc.json.document === "52998224725", restoreDoc);
  });

  it("members only see what they created", async () => {
    const biaClient = await bia.session.call("POST", "/api/clients", { name: "Cliente da Bia" });
    check("member creates a client", biaClient.status === 201 && biaClient.json.createdById === bia.userId, biaClient);
    const biaList = await bia.session.call("GET", "/api/clients");
    check("member sees only her own clients", biaList.json?.total === 1 && biaList.json.items[0].id === biaClient.json.id, biaList.json);
    check("member cannot read another member's client (404)", (await bia.session.call("GET", `/api/clients/${maria.id}`)).status === 404);
    check("member cannot update another member's client (404)", (await bia.session.call("PATCH", `/api/clients/${maria.id}`, { name: "Hack Hack" })).status === 404);
    check("member cannot delete another member's client (404)", (await bia.session.call("DELETE", `/api/clients/${maria.id}`)).status === 404);
    const anaList = await ana.session.call("GET", "/api/clients");
    check("owner sees everything in the organization", anaList.json?.total === 4, anaList.json);
    check("owner can read the member's client", (await ana.session.call("GET", `/api/clients/${biaClient.json.id}`)).status === 200);
  });

  it("tenant isolation", async () => {
    check("other organization cannot read the client (404)", (await carlos.session.call("GET", `/api/clients/${maria.id}`)).status === 404);
    check("other organization cannot update the client (404)", (await carlos.session.call("PATCH", `/api/clients/${maria.id}`, { name: "Hack Hack" })).status === 404);
    check("other organization cannot delete the client (404)", (await carlos.session.call("DELETE", `/api/clients/${maria.id}`)).status === 404);
    const carlosList = await carlos.session.call("GET", "/api/clients");
    check("other organization lists only its own", carlosList.json?.total === 1 && carlosList.json.items[0].name === "Maria do Carlos", carlosList.json);
    const stillThere = await prisma.client.findUnique({ where: { id: maria.id } });
    check("client untouched after cross-tenant attempts", stillThere?.name === "Maria O. Santos", stillThere);
  });

  it("delete", async () => {
    const usage = await prisma.propertyTypeUsage.findFirst();
    if (!usage) throw new Error("reference data missing: run npm run db:seed");
    const property = await prisma.property.create({
      data: {
        organizationId: ana.organizationId, createdById: ana.userId, clientId: company.json.id,
        name: "Sala 101", propertyType: usage.propertyType, usageType: usage.usageType,
      },
    });
    const blocked = await ana.session.call("DELETE", `/api/clients/${company.json.id}`);
    check("delete client that owns properties -> 409 with count", blocked.status === 409 && blocked.json?.error?.details?.properties === 1, blocked);
    await prisma.property.delete({ where: { id: property.id } });
    const deleted = await ana.session.call("DELETE", `/api/clients/${company.json.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("deleted client is gone (404)", (await ana.session.call("GET", `/api/clients/${company.json.id}`)).status === 404);
    check("delete twice -> 404", (await ana.session.call("DELETE", `/api/clients/${company.json.id}`)).status === 404);
  });
});
