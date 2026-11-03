import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { countPdfPages, looksLikePdf } from "../helpers/pdf.js";
import { type Account, Session, createCast, prisma, resetDatabase, storage } from "../helpers/world.js";

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Contract template and contract PDF API", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let apto: string;
  let flat: string;
  let biaProperty: string;
  let contractId: string;
  let shortStayId: string;
  let biaContractId: string;
  let firstPdfKey: string;

  const mkProperty = async (who: Account, body: Record<string, unknown>) => {
    const r = await who.session.call("POST", "/api/properties", { propertyType: "residential", usageType: "rental", rentalMode: "contract", ...body });
    if (r.status !== 201) throw new Error(`property: ${JSON.stringify(r)}`);
    return r.json.id as string;
  };
  const keyOfPdf = async (id: string) =>
    (await prisma.contract.findUniqueOrThrow({ where: { id }, select: { pdfFile: { select: { storageKey: true } } } })).pdfFile?.storageKey ?? null;

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("template without session -> 401", (await anon.call("GET", "/api/contract-template")).status === 401);
    check("generate without session -> 401", (await anon.call("POST", `/api/contracts/${UNKNOWN}/pdf`)).status === 401);
    check("download without session -> 401", (await anon.download(`/api/contracts/${UNKNOWN}/pdf`)).status === 401);
    ({ ana, bia, carlos } = await createCast());
  });

  it("serves the default template until the organization writes its own", async () => {
    const template = await ana.session.call("GET", "/api/contract-template");
    check("default: marked as such, with the three parts", template.status === 200 && template.json.isDefault === true && template.json.updatedAt === null && template.json.header.includes("CONTRATO DE LOCAÇÃO") && template.json.clauses.includes("{{locatario}}") && template.json.footer.length > 0, template.json);
    check("the editor gets the catalog of tokens", template.json?.placeholders?.length === 12 && template.json.placeholders.some((p: { token: string }) => p.token === "valor_mensal"), template.json?.placeholders?.length);
    check("the default uses only known tokens", template.json?.unknownPlaceholders?.length === 0);
    check("any member can read it", (await bia.session.call("GET", "/api/contract-template")).json?.isDefault === true);
    check("organizations do not share one", (await carlos.session.call("GET", "/api/contract-template")).json?.isDefault === true);
  });

  it("lets owners and admins edit it, sanitizing the HTML", async () => {
    const dirty = {
      header: '<h1 onclick="steal()">CONTRATO <span style="color:red">DE LOCAÇÃO</span></h1><script>alert(1)</script>',
      clauses: '<div>Locador: {{locador}}</div><p>Inquilino {{locatario}} em <a href="javascript:alert(1)">{{imovel}}</a></p><img src=x onerror=alert(1)><iframe src="//evil"></iframe><style>p{display:none}</style><p>Valor {{valor_mensal}} e {{ foo }}.</p>',
      footer: "<p><em>fim</em></p>",
    };
    const saved = await ana.session.call("PUT", "/api/contract-template", dirty);
    check("save -> 200, no longer the default", saved.status === 200 && saved.json.isDefault === false && saved.json.updatedById === ana.userId && typeof saved.json.updatedAt === "string", saved);
    check("scripts, handlers, links, images, iframes and styles are gone", !/script|onclick|onerror|javascript|<img|<iframe|<style|<a |color:red|display:none|alert/.test(`${saved.json.header}${saved.json.clauses}${saved.json.footer}`), saved.json);
    check("the allowed formatting and the text survive", saved.json?.header === "<h1>CONTRATO DE LOCAÇÃO</h1>" && saved.json.clauses.includes("<strong>") === false && saved.json.clauses.includes("{{locador}}") && saved.json.footer === "<p><em>fim</em></p>", saved.json);
    check("a div becomes a paragraph", saved.json?.clauses?.startsWith("<p>Locador: {{locador}}</p>"), saved.json?.clauses);
    check("a token that is not in the catalog is reported, not rejected", saved.json?.unknownPlaceholders?.join() === "foo", saved.json?.unknownPlaceholders);
    check("a member reads the new template", (await bia.session.call("GET", "/api/contract-template")).json?.isDefault === false);
    check("the other organization still has the default", (await carlos.session.call("GET", "/api/contract-template")).json?.isDefault === true);

    check("a member cannot edit it (403)", (await bia.session.call("PUT", "/api/contract-template", { header: "", clauses: "<p>x</p>", footer: "" })).status === 403);
    check("a member cannot reset it (403)", (await bia.session.call("DELETE", "/api/contract-template")).status === 403);
    const bad = (name: string, body: unknown) => ana.session.call("PUT", "/api/contract-template", body).then((r) => check(name, r.status === 400, r));
    await bad("empty clauses -> 400", { header: "", clauses: "", footer: "" });
    await bad("clauses made only of scripts -> 400", { header: "", clauses: "<script>alert(1)</script>", footer: "" });
    await bad("clauses over the size limit -> 400", { header: "", clauses: `<p>${"x".repeat(100_001)}</p>`, footer: "" });
    await bad("header over the size limit -> 400", { header: "x".repeat(5_001), clauses: "<p>x</p>", footer: "" });
    await bad("missing parts -> 400", { clauses: "<p>x</p>" });
    check("a failed edit left the saved template alone", (await ana.session.call("GET", "/api/contract-template")).json?.footer === "<p><em>fim</em></p>");
  });

  it("generates the PDF of a conventional contract", async () => {
    apto = await mkProperty(ana, {
      name: "Apto 1", usageType: "rental",
      address: { cityId: (await prisma.city.findFirstOrThrow({ where: { name: "Campinas", state: "SP" } })).ibgeCode, street: "Rua Barão de Jaguara", number: "100", complement: "apto 12", neighborhood: "Centro", postalCode: "13015904" },
    });
    const created = await ana.session.call("POST", "/api/contracts", {
      propertyId: apto, contractType: "conventional", startDate: "2026-01-01", endDate: "2026-12-31",
      rentTerms: { monthlyRentCents: 350_000, dueDay: 5, adjustmentIndex: "igpm" },
      occupant: { name: "João <b>Inquilino</b>", document: "529.982.247-25" },
    });
    contractId = created.json.id;
    check("(setup) the contract has no PDF yet", created.json?.pdfUrl === null, created.json);

    const before = await prisma.auditLog.count({ where: { action: "generate_pdf" } });
    const generated = await ana.session.call("POST", `/api/contracts/${contractId}/pdf`);
    check("generate -> 200 with the file name, size and URL", generated.status === 200 && generated.json.contractId === contractId && generated.json.fileName === "contrato-apto-1-joao-b-inquilino-b.pdf" && generated.json.sizeBytes > 1000 && generated.json.url === `/api/contracts/${contractId}/pdf`, generated);
    check("the contract now points to it", (await ana.session.call("GET", `/api/contracts/${contractId}`)).json?.pdfUrl === `/api/contracts/${contractId}/pdf`);

    const file = await ana.session.download(generated.json.url);
    check("download: a real PDF, as an attachment, typed, never cached", file.status === 200 && looksLikePdf(file.bytes) && countPdfPages(file.bytes) >= 1 && file.headers.get("content-type") === "application/pdf" && file.headers.get("content-disposition")?.startsWith("attachment;") === true && file.headers.get("cache-control") === "private, no-store" && file.bytes.length === generated.json.sizeBytes, Object.fromEntries(file.headers));

    firstPdfKey = (await keyOfPdf(contractId))!;
    const record = await prisma.storedFile.findFirstOrThrow({ where: { storageKey: firstPdfKey } });
    check("recorded as a PDF of the organization, uploaded by the caller, under a generated key", record.mimeType === "application/pdf" && record.organizationId === ana.organizationId && record.uploadedById === ana.userId && /\/[0-9a-f-]{36}\.pdf$/.test(firstPdfKey), record);
    check("the bytes are in the storage", (await storage.get(firstPdfKey))?.body.equals(file.bytes) === true);
    check("generating is audited", (await prisma.auditLog.count({ where: { action: "generate_pdf", entityId: contractId } })) === 1 && (await prisma.auditLog.count({ where: { action: "generate_pdf" } })) === before + 1);
  });

  it("regenerates after the property gets an owner", async () => {
    // What ends up in the text is covered by tests/unit/contract-documents-service.test.ts.
    const client = (await ana.session.call("POST", "/api/clients", { name: "Maria Proprietária", document: "168.995.350-09" })).json;
    check("(setup) the property gets an owner", (await ana.session.call("PATCH", `/api/properties/${apto}`, { clientId: client.id })).status === 200);
    const regenerated = await ana.session.call("POST", `/api/contracts/${contractId}/pdf`);
    check("regenerating after the change -> 200", regenerated.status === 200, regenerated);
  });

  it("replaces the previous PDF instead of piling them up", async () => {
    const secondKey = (await keyOfPdf(contractId))!;
    check("a new object under a new key", secondKey !== firstPdfKey);
    check("the previous object is gone from the storage", (await storage.get(firstPdfKey)) === null);
    check("and so is its record", (await prisma.storedFile.count({ where: { storageKey: firstPdfKey } })) === 0);
    check("exactly one PDF record for the contract", (await prisma.storedFile.count({ where: { contractPdfs: { some: { id: contractId } } } })) === 1);
    check("the new one downloads", looksLikePdf((await ana.session.download(`/api/contracts/${contractId}/pdf`)).bytes));
  });

  it("refuses what has no PDF", async () => {
    flat = await mkProperty(ana, { name: "Flat", usageType: "short_stay" });
    const stay = await ana.session.call("POST", "/api/contracts", { propertyId: flat, contractType: "short_stay", startDate: "2026-01-01", occupant: { name: "Administradora" } });
    shortStayId = stay.json.id;
    const generate = await ana.session.call("POST", `/api/contracts/${shortStayId}/pdf`);
    check("a short-stay contract has no PDF (422)", generate.status === 422 && generate.json?.error?.code === "BUSINESS_RULE_VIOLATION", generate);

    const other = await mkProperty(ana, { name: "Casa 2", usageType: "rental" });
    const fresh = await ana.session.call("POST", "/api/contracts", { propertyId: other, contractType: "conventional", startDate: "2026-01-01", rentTerms: { monthlyRentCents: 100_000, dueDay: 1 }, occupant: { name: "Outro" } });
    const download = await ana.session.download(`/api/contracts/${fresh.json.id}/pdf`);
    check("downloading before generating -> 404", download.status === 404);
    check("unknown contract -> 404 on both", (await ana.session.call("POST", `/api/contracts/${UNKNOWN}/pdf`)).status === 404 && (await ana.session.download(`/api/contracts/${UNKNOWN}/pdf`)).status === 404);
    check("non-uuid id -> 400", (await ana.session.call("POST", "/api/contracts/xyz/pdf")).status === 400);
  });

  it("covers a contract in any status and without a client, address or end date", async () => {
    const bare = await mkProperty(ana, { name: "Sem endereço", usageType: "rental" });
    const created = await ana.session.call("POST", "/api/contracts", { propertyId: bare, contractType: "conventional", startDate: "2026-02-01", rentTerms: { monthlyRentCents: 123_456, dueDay: 31 }, occupant: { name: "Fulano de Tal" } });
    check("open-ended, no address, no owner, no adjustment: still a PDF", (await ana.session.call("POST", `/api/contracts/${created.json.id}/pdf`)).status === 200);
    await ana.session.call("POST", `/api/contracts/${created.json.id}/end`, {});
    check("an ended contract keeps its PDF", looksLikePdf((await ana.session.download(`/api/contracts/${created.json.id}/pdf`)).bytes));
    check("and can be regenerated", (await ana.session.call("POST", `/api/contracts/${created.json.id}/pdf`)).status === 200);
  });

  it("falls back to a default after the template is reset", async () => {
    const reset = await ana.session.call("DELETE", "/api/contract-template");
    check("reset -> the default again", reset.status === 200 && reset.json.isDefault === true && reset.json.header.includes("CONTRATO DE LOCAÇÃO"), reset.json);
    check("the saved row is gone", (await prisma.contractTemplate.count({ where: { organizationId: ana.organizationId } })) === 0);
    check("resetting twice is fine", (await ana.session.call("DELETE", "/api/contract-template")).status === 200);
    check("generating still works with the default", (await ana.session.call("POST", `/api/contracts/${contractId}/pdf`)).status === 200);
  });

  it("keeps members and organizations apart", async () => {
    biaProperty = await mkProperty(bia, { name: "Imóvel da Bia", usageType: "rental" });
    const biaContract = await bia.session.call("POST", "/api/contracts", { propertyId: biaProperty, contractType: "conventional", startDate: "2026-01-01", rentTerms: { monthlyRentCents: 200_000, dueDay: 10 }, occupant: { name: "Inquilina da Bia" } });
    biaContractId = biaContract.json.id;
    check("a member generates the PDF of her own contract", (await bia.session.call("POST", `/api/contracts/${biaContractId}/pdf`)).status === 200 && looksLikePdf((await bia.session.download(`/api/contracts/${biaContractId}/pdf`)).bytes));
    check("a member cannot generate or download another member's PDF (404)", (await bia.session.call("POST", `/api/contracts/${contractId}/pdf`)).status === 404 && (await bia.session.download(`/api/contracts/${contractId}/pdf`)).status === 404);
    check("the owner reaches the member's PDF", (await ana.session.download(`/api/contracts/${biaContractId}/pdf`)).status === 200);
    check("another organization cannot generate or download (404)", (await carlos.session.call("POST", `/api/contracts/${contractId}/pdf`)).status === 404 && (await carlos.session.download(`/api/contracts/${contractId}/pdf`)).status === 404);
  });

  it("is 404 when the record exists but the object was lost", async () => {
    const key = (await keyOfPdf(biaContractId))!;
    await storage.delete(key);
    check("a lost object is a 404, not a crash", (await bia.session.download(`/api/contracts/${biaContractId}/pdf`)).status === 404);
    check("generating again repairs it", (await bia.session.call("POST", `/api/contracts/${biaContractId}/pdf`)).status === 200 && looksLikePdf((await bia.session.download(`/api/contracts/${biaContractId}/pdf`)).bytes));
  });
});
