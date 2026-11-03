import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { StorageProvider } from "../../src/lib/storage/storage.js";
import { runMaintenance } from "../../src/modules/maintenance/maintenance.js";
import { check } from "../helpers/check.js";
import { MIME, PDF, PNG } from "../helpers/fixtures.js";
import { type Account, Session, createCast, prisma, resetDatabase, storage } from "../helpers/world.js";

const DAY = 86_400_000;

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Maintenance", () => {
  let ana: Account;
  let guest: Session;
  let guestId: string;
  let demoId: string;
  let keys: string[];

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  /** A guest with a demo organization full of everything that points at a stored file. */
  async function buildDemoWorkspace() {
    const session = new Session();
    await session.call("POST", "/api/auth/sign-in/anonymous");
    const me = await session.call("GET", "/api/me");
    const organizationId = me.json.organizationId as string;
    const userId = me.json.user.id as string;

    const mk = async (body: Record<string, unknown>) => (await session.call("POST", "/api/properties", { propertyType: "residential", usageType: "rental", rentalMode: "contract", ...body })).json.id as string;
    const property = await mk({ name: "Apto da demo" });
    const flat = await mk({ name: "Flat da demo", usageType: "short_stay" });
    await session.call("POST", "/api/clients", { name: "Cliente da demo" });
    await session.call("POST", "/api/agencies", { name: "Imobiliária da demo" });
    const contract = await session.call("POST", "/api/contracts", { propertyId: property, contractType: "conventional", startDate: "2026-01-01", rentTerms: { monthlyRentCents: 100_000, dueDay: 5 }, occupant: { name: "Inquilino da demo" } });
    await session.call("POST", "/api/reservations", { propertyId: flat, checkIn: "2026-03-10", checkOut: "2026-03-12", occupant: { name: "Hóspede da demo" } });
    await session.call("POST", "/api/transactions", { propertyId: property, categoryId: (await prisma.transactionCategory.findFirstOrThrow()).id, amountCents: 1000, occurredOn: "2026-05-10" });
    await session.call("POST", `/api/properties/${property}/proposals`, { proposalType: "sale", amountCents: 100, proposalDate: "2026-05-01" });
    await session.upload(`/api/properties/${property}/photos`, { name: "a.png", type: MIME.png, bytes: PNG });
    await session.upload(`/api/properties/${property}/documents`, { name: "a.pdf", type: MIME.pdf, bytes: PDF });
    await session.call("POST", `/api/contracts/${contract.json.id}/pdf`);

    // A feedback that points at a stored file: the deletion order has to cope with it.
    const attachment = await prisma.storedFile.create({
      data: { organizationId, uploadedById: userId, storageKey: `${organizationId}/${randomUUID()}.png`, fileName: "print.png", mimeType: "image/png", sizeBytes: 3n },
    });
    await storage.put(attachment.storageKey, PNG, { contentType: "image/png" });
    await prisma.feedback.create({ data: { organizationId, userId, message: "Veja a imagem", attachmentFileId: attachment.id } });

    const files = await prisma.storedFile.findMany({ where: { organizationId }, select: { storageKey: true } });
    return { session, organizationId, userId, keys: files.map((f) => f.storageKey) };
  }

  it("leaves everything alone when nothing is due", async () => {
    ({ ana } = await createCast());
    const demo = await buildDemoWorkspace();
    guest = demo.session;
    guestId = demo.userId;
    demoId = demo.organizationId;
    keys = demo.keys;
    check("(setup) the demo workspace has 4 stored files: photo, document, contract PDF and a feedback attachment", keys.length === 4, keys.length);

    const report = await runMaintenance({ prisma, storage });
    check("a demo that has not expired is untouched", report.expiredDemoOrganizations === 0 && (await prisma.organization.count({ where: { id: demoId } })) === 1);
    check("nothing else was due either", Object.values(report).every((n) => n === 0), report);
  });

  it("expires a demo by the clock but never touches a real organization, however old", async () => {
    const tenYearsLater = await runMaintenance({ prisma, storage, now: new Date(Date.now() + 3650 * DAY) });
    check("only the demo organization goes", tenYearsLater.expiredDemoOrganizations === 1 && (await prisma.organization.count({ where: { id: demoId } })) === 0, tenYearsLater);
    check("the real organizations and accounts survive", (await prisma.organization.count({ where: { id: ana.organizationId } })) === 1 && (await prisma.user.count({ where: { email: "ana@example.com" } })) === 1);
  });

  it("deletes an expired demo with everything in it, files first", async () => {
    const demo = await buildDemoWorkspace();
    guest = demo.session;
    guestId = demo.userId;
    demoId = demo.organizationId;
    keys = demo.keys;
    check("(setup) every object exists", (await Promise.all(keys.map((key) => storage.get(key)))).every((object) => object !== null));
    await prisma.organization.update({ where: { id: demoId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });

    const report = await runMaintenance({ prisma, storage });
    check("the report counts the organization and the guest account", report.expiredDemoOrganizations === 1 && report.anonymousUsersRemoved === 1, report);

    const left = {
      organization: await prisma.organization.count({ where: { id: demoId } }),
      members: await prisma.member.count({ where: { organizationId: demoId } }),
      properties: await prisma.property.count({ where: { organizationId: demoId } }),
      contracts: await prisma.contract.count({ where: { organizationId: demoId } }),
      reservations: await prisma.reservation.count({ where: { organizationId: demoId } }),
      transactions: await prisma.transaction.count({ where: { organizationId: demoId } }),
      photos: await prisma.propertyPhoto.count({ where: { organizationId: demoId } }),
      documents: await prisma.propertyDocument.count({ where: { organizationId: demoId } }),
      files: await prisma.storedFile.count({ where: { organizationId: demoId } }),
      clients: await prisma.client.count({ where: { organizationId: demoId } }),
      occupants: await prisma.occupant.count({ where: { organizationId: demoId } }),
      agencies: await prisma.agency.count({ where: { organizationId: demoId } }),
      feedback: await prisma.feedback.count({ where: { organizationId: demoId } }),
      audit: await prisma.auditLog.count({ where: { organizationId: demoId } }),
    };
    check("not a single row is left", Object.values(left).every((n) => n === 0), left);
    check("every object is gone from the storage", (await Promise.all(keys.map((key) => storage.get(key)))).every((object) => object === null));
    check("the guest account and its sessions are gone", (await prisma.user.count({ where: { id: guestId } })) === 0 && (await prisma.session.count({ where: { userId: guestId } })) === 0);
    check("the guest's cookie no longer opens anything (401)", (await guest.call("GET", "/api/me")).status === 401);
    check("the other organizations are untouched", (await prisma.organization.count({ where: { id: ana.organizationId } })) === 1);
    check("a second run has nothing left to do", Object.values(await runMaintenance({ prisma, storage })).every((n) => n === 0));
  });

  it("keeps a demo whose files cannot be deleted, and retries on the next run", async () => {
    const demo = await buildDemoWorkspace();
    demoId = demo.organizationId;
    guestId = demo.userId;
    keys = demo.keys;
    await prisma.organization.update({ where: { id: demoId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });

    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    const failing: StorageProvider = { ...storage, delete: async (key) => { if (key === keys[0]) throw new Error("storage is down"); await storage.delete(key); } };
    const first = await runMaintenance({ prisma, storage: failing });
    console.error = original;

    check("the organization is kept (not orphaning the object that could not be deleted)", first.expiredDemoOrganizations === 0 && (await prisma.organization.count({ where: { id: demoId } })) === 1 && (await prisma.storedFile.count({ where: { organizationId: demoId } })) === 4, first);
    check("the failure was logged", logged.length > 0);
    check("the guest account is kept too", (await prisma.user.count({ where: { id: guestId } })) === 1);

    const second = await runMaintenance({ prisma, storage });
    check("the next run finishes the job", second.expiredDemoOrganizations === 1 && (await prisma.organization.count({ where: { id: demoId } })) === 0 && (await Promise.all(keys.map((key) => storage.get(key)))).every((object) => object === null), second);
  });

  it("removes a guest account only when the guest has nowhere left to work", async () => {
    const demo = await buildDemoWorkspace();
    // The guest also belongs to a second, permanent organization (invited, say).
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: demo.userId, role: "member" } });
    await prisma.organization.update({ where: { id: demo.organizationId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });

    const report = await runMaintenance({ prisma, storage });
    check("the demo goes but the account stays", report.expiredDemoOrganizations === 1 && report.anonymousUsersRemoved === 0 && (await prisma.user.count({ where: { id: demo.userId } })) === 1, report);
    await prisma.member.deleteMany({ where: { userId: demo.userId } });
    await prisma.user.delete({ where: { id: demo.userId } });
  });

  it("sweeps orphan files but not recent ones", async () => {
    const file = (createdAt: Date) => prisma.storedFile.create({ data: { organizationId: ana.organizationId, uploadedById: ana.userId, storageKey: `${ana.organizationId}/${randomUUID()}.png`, fileName: "x.png", mimeType: "image/png", sizeBytes: 3n, createdAt } });
    const old = await file(new Date(Date.now() - 2 * 3_600_000));
    const recent = await file(new Date(Date.now() - 60_000));
    await storage.put(old.storageKey, PNG, { contentType: "image/png" });
    await storage.put(recent.storageKey, PNG, { contentType: "image/png" });

    const report = await runMaintenance({ prisma, storage });
    check("the old orphan is swept, row and object", report.orphanFilesSwept === 1 && (await prisma.storedFile.count({ where: { id: old.id } })) === 0 && (await storage.get(old.storageKey)) === null, report);
    check("the recent one may be an upload in flight", (await prisma.storedFile.count({ where: { id: recent.id } })) === 1 && (await storage.get(recent.storageKey)) !== null);
    check("the grace period is configurable", (await runMaintenance({ prisma, storage, orphanGraceMinutes: 0, now: new Date(Date.now() + 1000) })).orphanFilesSwept === 1);
  });

  it("applies the audit retention", async () => {
    const old = await prisma.auditLog.create({ data: { action: "view", createdAt: new Date(Date.now() - 400 * DAY) } });
    const recent = await prisma.auditLog.create({ data: { action: "view", createdAt: new Date(Date.now() - 30 * DAY) } });
    const report = await runMaintenance({ prisma, storage });
    check("older than 12 months is purged", report.auditEntriesPurged >= 1 && (await prisma.auditLog.count({ where: { id: old.id } })) === 0, report);
    check("recent entries stay", (await prisma.auditLog.count({ where: { id: recent.id } })) === 1);
    check("the retention is configurable", (await runMaintenance({ prisma, storage, auditRetentionDays: 10 })).auditEntriesPurged >= 1 && (await prisma.auditLog.count({ where: { id: recent.id } })) === 0);
  });

  it("purges expired sessions and verification tokens", async () => {
    const live = await prisma.session.count({ where: { userId: ana.userId } });
    const expired = await prisma.session.create({ data: { userId: ana.userId, token: randomUUID(), expiresAt: new Date(Date.now() - DAY) } });
    const stale = await prisma.verification.create({ data: { identifier: "x@example.com", value: "tok", expiresAt: new Date(Date.now() - DAY) } });
    const valid = await prisma.verification.create({ data: { identifier: "y@example.com", value: "tok", expiresAt: new Date(Date.now() + DAY) } });

    const report = await runMaintenance({ prisma, storage });
    check("expired sessions and tokens are purged", report.expiredSessionsPurged === 1 && report.expiredVerificationsPurged === 1 && (await prisma.session.count({ where: { id: expired.id } })) === 0 && (await prisma.verification.count({ where: { id: stale.id } })) === 0, report);
    check("valid ones stay", (await prisma.session.count({ where: { userId: ana.userId } })) === live && (await prisma.verification.count({ where: { id: valid.id } })) === 1);
  });
});
