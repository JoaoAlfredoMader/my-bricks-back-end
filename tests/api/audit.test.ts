import { afterAll, beforeAll, describe, it } from "vitest";
import { createAuditRepository } from "../../src/modules/audit/audit.repository.js";
import { check } from "../helpers/check.js";
import { type Account, Session, createCast, prisma, resetDatabase, signUp } from "../helpers/world.js";

/** Reads the trail straight from the database. */
const trail = (where: Record<string, unknown> = {}) =>
  prisma.auditLog.findMany({ where, orderBy: { id: "asc" } });

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Audit log", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let admin: Session;
  let propertyId: string;
  let contractId: string;
  let reservationId: string;

  const ME = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest-browser/1.0" };

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("records sign-ups as logins", async () => {
    const anon = new Session();
    check("reading the trail without a session -> 401", (await anon.call("GET", "/api/audit-logs")).status === 401);
    ({ ana, bia, carlos } = await createCast());

    const logins = await trail({ action: "login" });
    check("each sign-up left a login entry", logins.length === 3 && logins.some((e) => e.actorEmail === "ana@example.com"), logins.length);
    const anaLogin = logins.find((e) => e.actorEmail === "ana@example.com");
    check("the entry names the actor and has no record attached", anaLogin?.actorUserId === ana.userId && anaLogin.actorName === "Ana Souza" && anaLogin.entityType === null && anaLogin.entityId === null, anaLogin);

    const again = new Session();
    await again.call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-forte-123" }, undefined, ME);
    const last = (await trail({ action: "login", actorUserId: ana.userId })).at(-1);
    check("a sign-in records the address and the browser", last?.ipAddress === "203.0.113.7" && last.userAgent === "vitest-browser/1.0", last);
    await new Session().call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-errada-1" });
    check("a failed sign-in is not a login", (await trail({ action: "login", actorUserId: ana.userId })).length === 2);
  });

  it("records what members do to records", async () => {
    const created = await ana.session.call("POST", "/api/properties", { name: "Apto 1", propertyType: "residential", usageType: "rental", rentalMode: "contract" }, undefined, ME);
    propertyId = created.json.id;
    const entry = (await trail({ action: "create", entityType: "property" }))[0];
    check("create: who, what, where and when", entry?.actorUserId === ana.userId && entry.actorRole === "owner" && entry.organizationId === ana.organizationId && entry.entityId === propertyId, entry);
    check("create: address, browser and the request in the details", entry?.ipAddress === "203.0.113.7" && entry.userAgent === "vitest-browser/1.0" && JSON.parse(entry.details ?? "{}").method === "POST" && JSON.parse(entry.details ?? "{}").status === 201, entry);

    await ana.session.call("PATCH", `/api/properties/${propertyId}`, { name: "Apto 1 B" });
    const update = (await trail({ action: "update", entityType: "property" }))[0];
    check("update names the record from the path", update?.entityId === propertyId && JSON.parse(update.details ?? "{}").path === `/api/properties/${propertyId}`, update);

    const client = await ana.session.call("POST", "/api/clients", { name: "Maria Oliveira" });
    check("a client is audited", (await trail({ action: "create", entityType: "client", entityId: client.json.id })).length === 1);
    const tx = await ana.session.call("POST", "/api/transactions", { propertyId, categoryId: (await prisma.transactionCategory.findFirstOrThrow()).id, amountCents: 1000, occurredOn: "2026-05-10" });
    check("a transaction is audited", (await trail({ action: "create", entityType: "transaction", entityId: tx.json.id })).length === 1);

    const contract = await ana.session.call("POST", "/api/contracts", { propertyId, contractType: "conventional", startDate: "2026-01-01", rentTerms: { monthlyRentCents: 300_000, dueDay: 5 }, occupant: { name: "Inquilino" } });
    contractId = contract.json.id;
    check("a contract creation is audited", (await trail({ action: "create", entityType: "contract", entityId: contractId })).length === 1);
    check("ending a contract is its own action", (await ana.session.call("POST", `/api/contracts/${contractId}/end`, {})).status === 200 && (await trail({ action: "end_contract", entityId: contractId })).length === 1);
    const second = await ana.session.call("POST", "/api/contracts", { propertyId, contractType: "conventional", startDate: "2026-06-01", rentTerms: { monthlyRentCents: 300_000, dueDay: 5 }, occupant: { name: "Outro" } });
    check("cancelling a contract is audited", (await ana.session.call("POST", `/api/contracts/${second.json.id}/cancel`)).status === 200 && (await trail({ action: "cancel", entityType: "contract", entityId: second.json.id })).length === 1);

    const flat = (await ana.session.call("POST", "/api/properties", { name: "Flat", propertyType: "residential", usageType: "short_stay" })).json.id;
    const reservation = await ana.session.call("POST", "/api/reservations", { propertyId: flat, checkIn: "2026-03-10", checkOut: "2026-03-12", occupant: { name: "Hóspede" } });
    reservationId = reservation.json.id;
    check("a reservation creation is audited", (await trail({ action: "create", entityType: "reservation", entityId: reservationId })).length === 1);
    check("cancelling a reservation is audited", (await ana.session.call("POST", `/api/reservations/${reservationId}/cancel`)).status === 200 && (await trail({ action: "cancel", entityType: "reservation", entityId: reservationId })).length === 1);
    check("a delete is audited with the deleted id", (await ana.session.call("DELETE", `/api/properties/${flat}`)).status === 204 && (await trail({ action: "delete", entityType: "property", entityId: flat })).length === 1);
  });

  it("does not record what did not happen", async () => {
    const before = (await trail()).length;
    check("an invalid request is rejected (400)", (await ana.session.call("POST", "/api/clients", { name: "A" })).status === 400);
    check("a record that does not exist (404)", (await ana.session.call("PATCH", "/api/clients/00000000-0000-4000-8000-000000000000", { name: "Fulano" })).status === 404);
    check("a conflict (409)", (await ana.session.call("POST", "/api/contracts", { propertyId, contractType: "conventional", startDate: "2026-02-01", rentTerms: { monthlyRentCents: 1, dueDay: 5 }, occupantId: "00000000-0000-4000-8000-000000000000" })).status === 400);
    check("reads leave no trace", (await ana.session.call("GET", "/api/properties")).status === 200);
    check("another member's record cannot be touched (404) and leaves no trace", (await carlos.session.call("DELETE", `/api/properties/${propertyId}`)).status === 404);
    check("nothing new was recorded", (await trail()).length === before, (await trail()).length - before);
  });

  it("lets owners and admins read their organization's trail", async () => {
    check("a member cannot read it (403)", (await bia.session.call("GET", "/api/audit-logs")).status === 403);

    const all = await ana.session.call("GET", "/api/audit-logs?pageSize=100");
    check("the owner reads the trail, newest first", all.status === 200 && all.json.total > 10 && BigInt(all.json.items[0].id) > BigInt(all.json.items.at(-1).id), all.json?.total);
    check("entries carry the numeric id as a string", typeof all.json?.items?.[0]?.id === "string");
    check("only this organization's entries", all.json.items.every((e: { organizationId: string | null }) => e.organizationId === ana.organizationId), all.json.items.map((e: { organizationId: string | null }) => e.organizationId));
    const carlosActions = (await ana.session.call("GET", `/api/audit-logs?pageSize=100&actorUserId=${carlos.userId}`)).json;
    check("the other organization's actors do not show up", carlosActions?.total === 0, carlosActions?.total);

    check("filter by action", (await ana.session.call("GET", "/api/audit-logs?action=end_contract")).json?.total === 1);
    check("filter by entity type", (await ana.session.call("GET", "/api/audit-logs?entityType=reservation")).json?.items?.every((e: { entityType: string }) => e.entityType === "reservation"));
    check("filter by actor", (await ana.session.call("GET", `/api/audit-logs?actorUserId=${ana.userId}&pageSize=100`)).json?.items?.every((e: { actorUserId: string }) => e.actorUserId === ana.userId));
    const today = new Date().toISOString().slice(0, 10);
    check("a day filter is inclusive on both ends", (await ana.session.call("GET", `/api/audit-logs?from=${today}&to=${today}`)).json?.total > 10);
    check("a window in the past is empty", (await ana.session.call("GET", "/api/audit-logs?from=2020-01-01&to=2020-12-31")).json?.total === 0);
    check("pagination", (await ana.session.call("GET", "/api/audit-logs?page=2&pageSize=5")).json?.items?.length === 5);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/audit-logs?pageSize=500")).status === 400);
    check("unknown action -> 400", (await ana.session.call("GET", "/api/audit-logs?action=explode")).status === 400);
    check("an organizationId in the query cannot widen the scope", (await ana.session.call("GET", `/api/audit-logs?organizationId=${carlos.organizationId}`)).json?.total === (await ana.session.call("GET", "/api/audit-logs")).json?.total);
    const carlosTrail = (await carlos.session.call("GET", "/api/audit-logs")).json;
    check("the other organization reads only its own trail", carlosTrail?.total > 0 && carlosTrail.items.every((e: { organizationId: string | null }) => e.organizationId === carlos.organizationId), carlosTrail);
  });

  it("records invitations and logouts", async () => {
    const invite = await ana.session.call("POST", "/api/auth/organization/invite-member", { email: "carla@example.com", role: "member", organizationId: ana.organizationId });
    check("invite -> 200", invite.status === 200, invite);
    const entry = (await trail({ action: "invite_member" }))[0];
    check("the invitation is in the trail with the invitee", entry?.actorUserId === ana.userId && entry.entityId === invite.json?.id && JSON.parse(entry.details ?? "{}").email === "carla@example.com" && entry.organizationId === ana.organizationId, entry);

    const bye = new Session();
    await bye.call("POST", "/api/auth/sign-in/email", { email: "bia@example.com", password: "senha-forte-123" });
    check("sign-out -> 200", (await bye.call("POST", "/api/auth/sign-out", {}, undefined, ME)).status === 200);
    const logout = (await trail({ action: "logout" })).at(-1);
    check("the logout names who left, read before the session died", logout?.actorUserId === bia.userId && logout.ipAddress === "203.0.113.7", logout);
  });

  it("marks what a platform admin did while impersonating", async () => {
    await prisma.user.update({ where: { email: "ana@example.com" }, data: { role: "admin" } });
    admin = new Session();
    await admin.call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-forte-123" });

    check("impersonate -> 200", (await admin.call("POST", "/api/auth/admin/impersonate-user", { userId: bia.userId })).status === 200);
    const start = (await trail({ action: "impersonate_start" }))[0];
    check("start is recorded: the target is the actor, the admin is the impersonator", start?.actorUserId === bia.userId && start.impersonatedById === ana.userId && start.entityId === bia.userId, start);

    const made = await admin.call("POST", "/api/clients", { name: "Criado em nome da Bia" });
    const during = (await trail({ action: "create", entityType: "client", entityId: made.json.id }))[0];
    check("an action during impersonation carries the impersonator", during?.actorUserId === bia.userId && during.impersonatedById === ana.userId, during);
    const before = (await trail()).length;
    check("a blocked delete (403) leaves no trace", (await admin.call("DELETE", `/api/clients/${made.json.id}`)).status === 403 && (await trail()).length === before);

    check("stop impersonating -> 200", (await admin.call("POST", "/api/auth/admin/stop-impersonating", {})).status === 200);
    const end = (await trail({ action: "impersonate_end" }))[0];
    check("end is recorded with the impersonator", end?.impersonatedById === ana.userId && end.actorUserId === bia.userId, end);
  });

  it("gives the platform admin the whole trail", async () => {
    check("a normal user cannot read it (403)", (await carlos.session.call("GET", "/api/admin/audit-logs")).status === 403);
    check("nor can an organization owner who is not a platform admin", (await new Session().call("GET", "/api/admin/audit-logs")).status === 401);

    const everything = await admin.call("GET", "/api/admin/audit-logs?pageSize=100");
    const orgs = new Set(everything.json.items.map((e: { organizationId: string | null }) => e.organizationId));
    check("the admin sees every organization", everything.status === 200 && orgs.has(ana.organizationId) && orgs.has(carlos.organizationId), [...orgs]);
    const narrowed = await admin.call("GET", `/api/admin/audit-logs?organizationId=${carlos.organizationId}&pageSize=100`);
    check("and can narrow it to one", narrowed.json?.items?.length > 0 && narrowed.json.items.every((e: { organizationId: string }) => e.organizationId === carlos.organizationId), narrowed.json?.total);
    check("the same filters apply", (await admin.call("GET", "/api/admin/audit-logs?action=impersonate_start")).json?.total === 1);

    await ana.session.call("POST", "/api/feedback", { message: "Só uma sugestão." });
    const feedbackId = (await prisma.feedback.findFirstOrThrow()).id;
    await admin.call("PATCH", `/api/admin/feedback/${feedbackId}`, { status: "resolved" });
    const platform = (await trail({ action: "update", entityType: "feedback" }))[0];
    check("an operator action on feedback is a platform-level event", platform?.organizationId === null && platform.entityId === feedbackId, platform);
  });

  it("keeps the actor snapshot after the user is gone, and applies retention", async () => {
    const dave = await signUp("Dave Costa", "dave@example.com");
    check("(setup) dave signed up", (await trail({ action: "login", actorUserId: dave.userId })).length === 1);
    await prisma.user.delete({ where: { id: dave.userId } });
    const orphan = (await trail({ actorEmail: "dave@example.com" }))[0];
    check("the entry survives, detached from the deleted user, with the name and e-mail", orphan?.actorUserId === null && orphan.actorName === "Dave Costa" && orphan.actorEmail === "dave@example.com", orphan);

    const old = await prisma.auditLog.create({ data: { action: "view", createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    const repository = createAuditRepository(prisma);
    const removed = await repository.deleteOlderThan(new Date(Date.now() - 365 * 86_400_000));
    check("retention removes the entries older than the cut-off", removed === 1 && (await prisma.auditLog.count({ where: { id: old.id } })) === 0, removed);
    check("and keeps the recent ones", (await prisma.auditLog.count()) > 10);
  });
});
