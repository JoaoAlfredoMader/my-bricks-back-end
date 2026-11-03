import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { sweepOrphanFiles } from "../../src/modules/files/orphan-sweep.js";
import { check } from "../helpers/check.js";
import { HTML_AS_IMAGE, JPEG, MIME, PDF, PNG, WEBP } from "../helpers/fixtures.js";
import { type Account, Session, createCast, prisma, resetDatabase, storage } from "../helpers/world.js";

const photos = (propertyId: string) => `/api/properties/${propertyId}/photos`;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Property photos API", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let apto: string;
  let biaProperty: string;
  let carlosProperty: string;
  let p1: { id: string; contentUrl: string };
  let p2: { id: string };
  let p3: { id: string };

  const mk = async (who: Account, name: string) => {
    const r = await who.session.call("POST", "/api/properties", { name, propertyType: "residential", usageType: "rental" });
    if (r.status !== 201) throw new Error(`property: ${JSON.stringify(r)}`);
    return r.json.id as string;
  };
  const keyOf = async (photoId: string) =>
    (await prisma.propertyPhoto.findUniqueOrThrow({ where: { id: photoId }, select: { file: { select: { storageKey: true } } } })).file.storageKey;

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("list without session -> 401", (await anon.call("GET", photos(UNKNOWN))).status === 401);
    check("upload without session -> 401", (await anon.upload(photos(UNKNOWN), { name: "a.png", type: MIME.png, bytes: PNG })).status === 401);
    check("content without session -> 401", (await anon.download(`${photos(UNKNOWN)}/${UNKNOWN}/content`)).status === 401);
    ({ ana, bia, carlos } = await createCast());
    apto = await mk(ana, "Apto 1");
    biaProperty = await mk(bia, "Imóvel da Bia");
    carlosProperty = await mk(carlos, "Imóvel do Carlos");
  });

  it("uploads photos at the end of the list", async () => {
    const first = await ana.session.upload(photos(apto), { name: "fachada.png", type: MIME.png, bytes: PNG });
    check("upload -> 201", first.status === 201, first);
    p1 = first.json;
    check("it is the cover: position 0, with name, type and size", first.json?.position === 0 && first.json.fileName === "fachada.png" && first.json.mimeType === "image/png" && first.json.sizeBytes === PNG.length && first.json.propertyId === apto, first.json);
    check("the content URL points to the endpoint that serves it", first.json?.contentUrl === `${photos(apto)}/${first.json.id}/content`, first.json?.contentUrl);

    const stored = await prisma.storedFile.findFirstOrThrow({ where: { photos: { some: { id: p1.id } } } });
    check("the file is recorded for the organization and the uploader", stored.organizationId === ana.organizationId && stored.uploadedById === ana.userId && stored.mimeType === "image/png" && stored.sizeBytes === BigInt(PNG.length), stored);
    check("the key is <organization>/<uuid>.png and never the client's name", /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/.test(stored.storageKey) && stored.storageKey.startsWith(`${ana.organizationId}/`) && !stored.storageKey.includes("fachada"), stored.storageKey);
    check("the bytes are in the storage", (await storage.get(stored.storageKey))?.body.equals(PNG) === true);

    const second = await ana.session.upload(photos(apto), { name: "sala.jpg", type: MIME.jpeg, bytes: JPEG });
    const third = await ana.session.upload(photos(apto), { name: "cozinha.webp", type: MIME.webp, bytes: WEBP });
    p2 = second.json;
    p3 = third.json;
    check("JPEG and WebP are accepted, each at the end", second.status === 201 && second.json.position === 1 && third.status === 201 && third.json.position === 2, [second.json, third.json]);

    const hostile = await ana.session.upload(photos(apto), { name: "../../evil.png", type: MIME.png, bytes: PNG });
    check("a hostile file name is reduced to its last part", hostile.status === 201 && hostile.json.fileName === "evil.png", hostile.json);
    await ana.session.call("DELETE", `${photos(apto)}/${hostile.json.id}`);
  });

  it("lists in order and serves the image", async () => {
    const list = await ana.session.call("GET", photos(apto));
    check("the list is ordered by position", list.status === 200 && list.json.map((p: { id: string }) => p.id).join() === [p1.id, p2.id, p3.id].join(), list.json);

    const image = await ana.session.download(p1.contentUrl);
    check("the content is the uploaded image", image.status === 200 && image.bytes.equals(PNG));
    check("served with its type, inline, private and nosniff", image.headers.get("content-type") === "image/png" && image.headers.get("content-disposition")?.startsWith("inline;") === true && image.headers.get("cache-control")?.startsWith("private") === true && image.headers.get("x-content-type-options") === "nosniff" && image.headers.get("content-length") === String(PNG.length), Object.fromEntries(image.headers));
    check("a photo under the wrong property -> 404", (await ana.session.download(`${photos(biaProperty)}/${p1.id}/content`)).status === 404);
    check("unknown photo -> 404", (await ana.session.download(`${photos(apto)}/${UNKNOWN}/content`)).status === 404);
    check("non-uuid ids -> 400", (await ana.session.download(`${photos("xyz")}/${p1.id}/content`)).status === 400);
    check("an empty property has an empty list", (await bia.session.call("GET", photos(biaProperty))).json?.length === 0);
    check("an unknown property is a 404, not an empty list", (await ana.session.call("GET", photos(UNKNOWN))).status === 404);
  });

  it("reorders the photos", async () => {
    const order = async (ids: string[]) => ana.session.call("PUT", `${photos(apto)}/order`, { photoIds: ids });
    const reordered = await order([p3.id, p1.id, p2.id]);
    check("a complete permutation is applied", reordered.status === 200 && reordered.json.map((p: { id: string }) => p.id).join() === [p3.id, p1.id, p2.id].join() && reordered.json.map((p: { position: number }) => p.position).join() === "0,1,2", reordered.json);
    check("and persisted", (await ana.session.call("GET", photos(apto))).json[0].id === p3.id);

    check("a missing photo -> 400", (await order([p3.id, p1.id])).status === 400);
    check("a duplicate -> 400", (await order([p3.id, p3.id, p1.id])).status === 400);
    check("an unknown photo -> 400", (await order([p3.id, p1.id, UNKNOWN])).status === 400);
    check("another property's photo -> 400", (await order([p3.id, p1.id, p2.id, randomUUID()])).status === 400);
    check("an empty list -> 400", (await order([])).status === 400);
    check("a failed reorder changed nothing", (await ana.session.call("GET", photos(apto))).json.map((p: { id: string }) => p.id).join() === [p3.id, p1.id, p2.id].join());

    const next = await ana.session.upload(photos(apto), { name: "quarto.png", type: MIME.png, bytes: PNG });
    check("a new photo goes after the last one", next.json?.position === 3, next.json);
    await ana.session.call("DELETE", `${photos(apto)}/${next.json.id}`);
  });

  it("rejects what is not an acceptable image", async () => {
    const reject = async (name: string, status: number, code: string, file: Parameters<Session["upload"]>[1], fields?: Record<string, string>) => {
      const r = await ana.session.upload(photos(apto), file, fields);
      check(name, r.status === status && r.json?.error?.code === code, r);
    };
    await reject("no file in the form -> 400", 400, "VALIDATION_ERROR", null, { note: "oi" });
    await reject("an empty file -> 400", 400, "VALIDATION_ERROR", { name: "a.png", type: MIME.png, bytes: new Uint8Array(0) });
    await reject("a script claiming to be a PNG -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.png", type: MIME.png, bytes: HTML_AS_IMAGE });
    await reject("a JPEG claiming to be a PNG -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.png", type: MIME.png, bytes: JPEG });
    await reject("a PDF is not a photo -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.pdf", type: MIME.pdf, bytes: PDF });
    await reject("an HTML type -> 415", 415, "UNSUPPORTED_MEDIA_TYPE", { name: "a.html", type: "text/html", bytes: HTML_AS_IMAGE });
    await reject("a file in another field -> 400", 400, "VALIDATION_ERROR", { name: "a.png", type: MIME.png, bytes: PNG, field: "photo" });

    const tooBig = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await reject("a file over the limit -> 413 with the limit", 413, "PAYLOAD_TOO_LARGE", { name: "big.png", type: MIME.png, bytes: tooBig });
    check("the limit is reported in bytes", (await ana.session.upload(photos(apto), { name: "big.png", type: MIME.png, bytes: tooBig })).json?.error?.details?.maxBytes === 1024 * 1024);

    check("nothing was left behind by the rejected uploads", (await prisma.propertyPhoto.count({ where: { propertyId: apto } })) === 3 && (await prisma.storedFile.count({ where: { organizationId: ana.organizationId } })) === 3);
    check("unknown property -> 404", (await ana.session.upload(photos(UNKNOWN), { name: "a.png", type: MIME.png, bytes: PNG })).status === 404);
    check("non-uuid property -> 400", (await ana.session.upload(photos("xyz"), { name: "a.png", type: MIME.png, bytes: PNG })).status === 400);
  });

  it("caps the photos of a property", async () => {
    const full = await mk(ana, "Casa cheia");
    const files = Array.from({ length: 30 }, () => ({ id: randomUUID(), key: `${ana.organizationId}/${randomUUID()}.png` }));
    await prisma.storedFile.createMany({ data: files.map((f) => ({ id: f.id, organizationId: ana.organizationId, uploadedById: ana.userId, storageKey: f.key, fileName: "x.png", mimeType: "image/png", sizeBytes: 1n })) });
    await prisma.propertyPhoto.createMany({ data: files.map((f, position) => ({ organizationId: ana.organizationId, propertyId: full, fileId: f.id, position })) });

    const over = await ana.session.upload(photos(full), { name: "a.png", type: MIME.png, bytes: PNG });
    check("the 31st photo -> 422", over.status === 422 && over.json?.error?.code === "BUSINESS_RULE_VIOLATION", over);
  });

  it("keeps members and organizations apart", async () => {
    const mine = await bia.session.upload(photos(biaProperty), { name: "bia.png", type: MIME.png, bytes: PNG });
    check("a member uploads to her own property", mine.status === 201, mine);
    check("a member cannot list, upload to or read another member's photos (404)",
      (await bia.session.call("GET", photos(apto))).status === 404 &&
      (await bia.session.upload(photos(apto), { name: "x.png", type: MIME.png, bytes: PNG })).status === 404 &&
      (await bia.session.download(p1.contentUrl)).status === 404);
    check("a member cannot reorder or delete another member's photos (404)",
      (await bia.session.call("PUT", `${photos(apto)}/order`, { photoIds: [p1.id] })).status === 404 &&
      (await bia.session.call("DELETE", `${photos(apto)}/${p1.id}`)).status === 404);
    check("the owner reaches the member's photos", (await ana.session.call("GET", photos(biaProperty))).json?.length === 1 && (await ana.session.download(mine.json.contentUrl)).status === 200);

    check("another organization cannot list, upload, read, reorder or delete (404)",
      (await carlos.session.call("GET", photos(apto))).status === 404 &&
      (await carlos.session.upload(photos(apto), { name: "x.png", type: MIME.png, bytes: PNG })).status === 404 &&
      (await carlos.session.download(p1.contentUrl)).status === 404 &&
      (await carlos.session.call("PUT", `${photos(apto)}/order`, { photoIds: [p1.id] })).status === 404 &&
      (await carlos.session.call("DELETE", `${photos(apto)}/${p1.id}`)).status === 404);
    check("the other organization's files are stored under its own prefix", (await carlos.session.upload(photos(carlosProperty), { name: "c.png", type: MIME.png, bytes: PNG })).status === 201 && (await prisma.storedFile.count({ where: { storageKey: { startsWith: `${carlos.organizationId}/` } } })) === 1);
  });

  it("deletes the photo, its record and its object", async () => {
    const key = await keyOf(p2.id);
    check("(setup) the object exists", (await storage.get(key)) !== null);
    const deleted = await ana.session.call("DELETE", `${photos(apto)}/${p2.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("the file record is gone", (await prisma.storedFile.count({ where: { storageKey: key } })) === 0);
    check("the object is gone from the storage", (await storage.get(key)) === null);
    check("the list shrinks", (await ana.session.call("GET", photos(apto))).json?.length === 2);
    check("delete twice -> 404", (await ana.session.call("DELETE", `${photos(apto)}/${p2.id}`)).status === 404);
    check("the content is gone (404)", (await ana.session.download(`${photos(apto)}/${p2.id}/content`)).status === 404);
  });

  it("serves 404 when the row exists but the object was lost", async () => {
    const key = await keyOf(p3.id);
    await storage.delete(key);
    check("a lost object is a 404, not a crash", (await ana.session.download(`${photos(apto)}/${p3.id}/content`)).status === 404);
  });

  it("sweeps the files that nothing points to any more", async () => {
    const key = await keyOf(p1.id);
    check("deleting the property cascades the photo rows", (await ana.session.call("DELETE", `/api/properties/${apto}`)).status === 204 && (await prisma.propertyPhoto.count({ where: { propertyId: apto } })) === 0);
    check("…but the file records and the object stay until the sweep", (await prisma.storedFile.count({ where: { storageKey: key } })) === 1 && (await storage.get(key)) !== null);

    check("a recent file is not swept (an upload may be in flight)", (await sweepOrphanFiles(prisma, storage, { olderThan: new Date(Date.now() - 3_600_000) })) === 0 && (await storage.get(key)) !== null);
    const swept = await sweepOrphanFiles(prisma, storage, { olderThan: new Date(Date.now() + 1000) });
    check("the sweep removes orphan records and objects", swept >= 1 && (await prisma.storedFile.count({ where: { storageKey: key } })) === 0 && (await storage.get(key)) === null, swept);

    const stillUsed = await prisma.propertyPhoto.findFirstOrThrow({ where: { propertyId: biaProperty }, select: { file: { select: { storageKey: true } } } });
    check("files that are still referenced survive the sweep", (await storage.get(stillUsed.file.storageKey)) !== null && (await ana.session.call("GET", photos(biaProperty))).json?.length === 1);
    check("a second sweep has nothing to do", (await sweepOrphanFiles(prisma, storage, { olderThan: new Date(Date.now() + 1000) })) === 0);
  });
});
