import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { HTML_AS_IMAGE, JPEG, MIME, PDF, PNG, ZIP } from "../helpers/fixtures.js";
import { type Account, Session, createCast, prisma, resetDatabase, storage } from "../helpers/world.js";

const documents = (propertyId: string) => `/api/properties/${propertyId}/documents`;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Property documents API", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let apto: string;
  let biaProperty: string;
  let carlosProperty: string;
  let deed: { id: string; contentUrl: string };
  let tax: { id: string };

  const mk = async (who: Account, name: string) => {
    const r = await who.session.call("POST", "/api/properties", { name, propertyType: "residential", usageType: "rental" });
    if (r.status !== 201) throw new Error(`property: ${JSON.stringify(r)}`);
    return r.json.id as string;
  };

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("list without session -> 401", (await anon.call("GET", documents(UNKNOWN))).status === 401);
    check("upload without session -> 401", (await anon.upload(documents(UNKNOWN), { name: "a.pdf", type: MIME.pdf, bytes: PDF })).status === 401);
    check("download without session -> 401", (await anon.download(`${documents(UNKNOWN)}/${UNKNOWN}/content`)).status === 401);
    ({ ana, bia, carlos } = await createCast());
    apto = await mk(ana, "Apto 1");
    biaProperty = await mk(bia, "Imóvel da Bia");
    carlosProperty = await mk(carlos, "Imóvel do Carlos");
  });

  it("uploads documents of several types", async () => {
    const first = await ana.session.upload(documents(apto), { name: "Escritura 2ª via.pdf", type: MIME.pdf, bytes: PDF }, { category: "  escritura " });
    check("upload a PDF with a category -> 201", first.status === 201, first);
    deed = first.json;
    check("DTO: name, type, size, trimmed category and the download URL", first.json?.fileName === "Escritura 2ª via.pdf" && first.json.mimeType === "application/pdf" && first.json.sizeBytes === PDF.length && first.json.category === "escritura" && first.json.contentUrl === `${documents(apto)}/${first.json.id}/content`, first.json);

    const stored = await prisma.storedFile.findFirstOrThrow({ where: { documents: { some: { id: deed.id } } } });
    check("recorded for the organization and the uploader, under a generated key", stored.organizationId === ana.organizationId && stored.uploadedById === ana.userId && /\/[0-9a-f-]{36}\.pdf$/.test(stored.storageKey) && !stored.storageKey.includes("Escritura"), stored);
    check("the bytes are in the storage", (await storage.get(stored.storageKey))?.body.equals(PDF) === true);

    const second = await ana.session.upload(documents(apto), { name: "iptu.png", type: MIME.png, bytes: PNG }, { category: "IPTU" });
    tax = second.json;
    check("an image is a valid document too", second.status === 201, second);
    check("a Word file (zip container) is accepted", (await ana.session.upload(documents(apto), { name: "contrato.docx", type: MIME.docx, bytes: ZIP })).status === 201);
    check("an Excel file is accepted", (await ana.session.upload(documents(apto), { name: "planilha.xlsx", type: MIME.xlsx, bytes: ZIP })).status === 201);
    const noCategory = await ana.session.upload(documents(apto), { name: "foto.jpg", type: MIME.jpeg, bytes: JPEG }, { category: "" });
    check("a blank category is none", noCategory.status === 201 && noCategory.json.category === null, noCategory.json);
    check("the same file can be uploaded twice: each is its own document", (await ana.session.upload(documents(apto), { name: "Escritura 2ª via.pdf", type: MIME.pdf, bytes: PDF })).json?.id !== deed.id);
  });

  it("lists and filters", async () => {
    const list = await ana.session.call("GET", documents(apto));
    check("list: 6 documents, newest first", list.status === 200 && list.json.length === 6 && list.json[0].createdAt >= list.json.at(-1).createdAt, list.json?.length);
    check("filter by category, case-insensitive", (await ana.session.call("GET", `${documents(apto)}?category=ESCRITURA`)).json?.length === 1);
    check("a category that does not exist is an empty list", (await ana.session.call("GET", `${documents(apto)}?category=nada`)).json?.length === 0);
    check("an unknown property is a 404, not an empty list", (await ana.session.call("GET", documents(UNKNOWN))).status === 404);
    check("non-uuid property -> 400", (await ana.session.call("GET", documents("xyz"))).status === 400);
  });

  it("downloads as an attachment", async () => {
    const file = await ana.session.download(deed.contentUrl);
    check("the content is the uploaded file", file.status === 200 && file.bytes.equals(PDF));
    const disposition = file.headers.get("content-disposition") ?? "";
    check("always a download, with the real name encoded", disposition.startsWith("attachment;") && disposition.includes("filename*=UTF-8''Escritura%202%C2%AA%20via.pdf"), disposition);
    check("typed, never cached, nosniff", file.headers.get("content-type") === "application/pdf" && file.headers.get("cache-control") === "private, no-store" && file.headers.get("x-content-type-options") === "nosniff", Object.fromEntries(file.headers));
    check("a document under the wrong property -> 404", (await ana.session.download(`${documents(biaProperty)}/${deed.id}/content`)).status === 404);
    check("unknown document -> 404", (await ana.session.download(`${documents(apto)}/${UNKNOWN}/content`)).status === 404);
  });

  it("rejects what is not an acceptable document", async () => {
    const before = await prisma.storedFile.count();
    const reject = async (name: string, status: number, code: string, file: Parameters<Session["upload"]>[1], fields?: Record<string, string>) => {
      const r = await ana.session.upload(documents(apto), file, fields);
      check(name, r.status === status && r.json?.error?.code === code, r);
    };
    await reject("no file in the form -> 400", 400, "VALIDATION_ERROR", null, { category: "x" });
    await reject("an empty file -> 400", 400, "VALIDATION_ERROR", { name: "a.pdf", type: MIME.pdf, bytes: new Uint8Array(0) });
    await reject("HTML pretending to be a PDF -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.pdf", type: MIME.pdf, bytes: HTML_AS_IMAGE });
    await reject("a zip pretending to be a PDF -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.pdf", type: MIME.pdf, bytes: ZIP });
    await reject("an executable type -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.exe", type: "application/x-msdownload", bytes: Buffer.from("MZ") });
    await reject("plain text is not accepted -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.txt", type: "text/plain", bytes: Buffer.from("hello") });
    await reject("a category over 50 characters -> 400", 400, "VALIDATION_ERROR", { name: "a.pdf", type: MIME.pdf, bytes: PDF }, { category: "x".repeat(51) });
    await reject("a file over the limit -> 413", 413, "PAYLOAD_TOO_LARGE", { name: "big.pdf", type: MIME.pdf, bytes: Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]) });
    check("nothing was left behind", (await prisma.storedFile.count()) === before);
    check("unknown property -> 404", (await ana.session.upload(documents(UNKNOWN), { name: "a.pdf", type: MIME.pdf, bytes: PDF })).status === 404);
  });

  it("relabels documents", async () => {
    const renamed = await ana.session.call("PATCH", `${documents(apto)}/${tax.id}`, { category: "  Imposto  " });
    check("change the category", renamed.status === 200 && renamed.json.category === "Imposto", renamed);
    check("clear the category", (await ana.session.call("PATCH", `${documents(apto)}/${tax.id}`, { category: null })).json?.category === null);
    check("a blank category clears it too", (await ana.session.call("PATCH", `${documents(apto)}/${tax.id}`, { category: "  " })).json?.category === null);
    check("a category over 50 characters -> 400", (await ana.session.call("PATCH", `${documents(apto)}/${tax.id}`, { category: "x".repeat(51) })).status === 400);
    check("unknown document -> 404", (await ana.session.call("PATCH", `${documents(apto)}/${UNKNOWN}`, { category: "x" })).status === 404);
    check("the file itself is untouched", (await ana.session.download(`${documents(apto)}/${tax.id}/content`)).bytes.equals(PNG));
  });

  it("keeps members and organizations apart", async () => {
    const mine = await bia.session.upload(documents(biaProperty), { name: "bia.pdf", type: MIME.pdf, bytes: PDF });
    check("a member uploads to her own property", mine.status === 201, mine);
    check("a member cannot list, upload to or download another member's documents (404)",
      (await bia.session.call("GET", documents(apto))).status === 404 &&
      (await bia.session.upload(documents(apto), { name: "x.pdf", type: MIME.pdf, bytes: PDF })).status === 404 &&
      (await bia.session.download(deed.contentUrl)).status === 404);
    check("a member cannot relabel or delete them (404)",
      (await bia.session.call("PATCH", `${documents(apto)}/${deed.id}`, { category: "x" })).status === 404 &&
      (await bia.session.call("DELETE", `${documents(apto)}/${deed.id}`)).status === 404);
    check("the owner reaches the member's documents", (await ana.session.call("GET", documents(biaProperty))).json?.length === 1 && (await ana.session.download(mine.json.contentUrl)).status === 200);

    check("another organization cannot list, upload, download, relabel or delete (404)",
      (await carlos.session.call("GET", documents(apto))).status === 404 &&
      (await carlos.session.upload(documents(apto), { name: "x.pdf", type: MIME.pdf, bytes: PDF })).status === 404 &&
      (await carlos.session.download(deed.contentUrl)).status === 404 &&
      (await carlos.session.call("PATCH", `${documents(apto)}/${deed.id}`, { category: "x" })).status === 404 &&
      (await carlos.session.call("DELETE", `${documents(apto)}/${deed.id}`)).status === 404);
    check("the outsider's own documents work independently", (await carlos.session.upload(documents(carlosProperty), { name: "c.pdf", type: MIME.pdf, bytes: PDF })).status === 201);
  });

  it("deletes the document, its record and its object", async () => {
    const key = (await prisma.storedFile.findFirstOrThrow({ where: { documents: { some: { id: deed.id } } } })).storageKey;
    const deleted = await ana.session.call("DELETE", `${documents(apto)}/${deed.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("the file record and the object are gone", (await prisma.storedFile.count({ where: { storageKey: key } })) === 0 && (await storage.get(key)) === null);
    check("the other copy of the same file is untouched", (await ana.session.call("GET", documents(apto))).json?.length === 5);
    check("delete twice -> 404", (await ana.session.call("DELETE", `${documents(apto)}/${deed.id}`)).status === 404);
    check("download after delete -> 404", (await ana.session.download(deed.contentUrl)).status === 404);
  });

  it("is audited as uploads, updates and deletions of documents", async () => {
    const entries = await prisma.auditLog.findMany({ where: { entityType: "document" }, orderBy: { id: "asc" } });
    const actions = entries.map((entry) => entry.action);
    check("uploads are recorded with the document id", actions.includes("upload") && entries.filter((e) => e.action === "upload").every((e) => e.entityId !== null), actions);
    check("relabels and deletions are recorded too", actions.includes("update") && actions.includes("delete"), actions);
    check("rejected uploads are not: one entry per stored document (6 + 1 + 1)", entries.filter((e) => e.action === "upload").length === 8, entries.length);
  });
});
