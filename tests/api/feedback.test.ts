import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type Account, Session, createCast, prisma, resetDatabase } from "../helpers/world.js";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Feedback, platform admin and impersonation", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let admin: Session;
  let adminId: string;
  let first: { id: string };

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("send without session -> 401", (await anon.call("POST", "/api/feedback", { message: "Oi" })).status === 401);
    check("list without session -> 401", (await anon.call("GET", "/api/feedback")).status === 401);
    check("admin list without session -> 401", (await anon.call("GET", "/api/admin/feedback")).status === 401);
    ({ ana, bia, carlos } = await createCast());
  });

  it("sends feedback", async () => {
    const sent = await bia.session.call("POST", "/api/feedback", { message: "  O mapa demora a carregar.  " });
    check("send -> 201, open, trimmed", sent.status === 201 && sent.json.status === "open" && sent.json.message === "O mapa demora a carregar.", sent);
    first = sent.json;
    check("it is stored for the author in the organization she is working in", (await prisma.feedback.findUnique({ where: { id: first.id } }))?.organizationId === ana.organizationId);
    check("another message from the owner", (await ana.session.call("POST", "/api/feedback", { message: "Faltou um botão de exportar." })).status === 201);
    check("another one from the outsider", (await carlos.session.call("POST", "/api/feedback", { message: "Gostei do painel!" })).status === 201);

    check("message too short -> 400", (await bia.session.call("POST", "/api/feedback", { message: "a" })).status === 400);
    check("blank message -> 400", (await bia.session.call("POST", "/api/feedback", { message: "   " })).status === 400);
    check("missing message -> 400", (await bia.session.call("POST", "/api/feedback", {})).status === 400);
    check("message above the limit -> 400", (await bia.session.call("POST", "/api/feedback", { message: "x".repeat(5001) })).status === 400);
  });

  it("lists only the author's own feedback", async () => {
    const mine = await bia.session.call("GET", "/api/feedback");
    check("a user sees only what she sent", mine.json?.total === 1 && mine.json.items[0].id === first.id, mine.json);
    check("the user DTO does not expose other people's data", mine.json?.items?.[0]?.userEmail === undefined && mine.json.items[0].organizationName === undefined, mine.json?.items?.[0]);
    check("filter by status", (await bia.session.call("GET", "/api/feedback?status=resolved")).json?.total === 0);
    check("invalid status -> 400", (await bia.session.call("GET", "/api/feedback?status=closed")).status === 400);
    check("pageSize above the cap -> 400", (await bia.session.call("GET", "/api/feedback?pageSize=500")).status === 400);
  });

  it("keeps the operator panel for platform admins", async () => {
    check("a normal user cannot list all feedback (403)", (await ana.session.call("GET", "/api/admin/feedback")).status === 403);
    check("a normal user cannot change a status (403)", (await bia.session.call("PATCH", `/api/admin/feedback/${first.id}`, { status: "resolved" })).status === 403);
    check("being the organization owner does not make anyone a platform admin", (await ana.session.call("GET", "/api/admin/feedback")).json?.error?.code === "FORBIDDEN");

    await prisma.user.update({ where: { email: "ana@example.com" }, data: { role: "admin" } });
    admin = new Session();
    const signIn = await admin.call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-forte-123" });
    check("the promoted user signs in again", signIn.status === 200, signIn);
    adminId = ana.userId;
  });

  it("lets the platform admin read and close feedback", async () => {
    const all = await admin.call("GET", "/api/admin/feedback");
    check("admin sees all 3 feedbacks with author and organization", all.status === 200 && all.json.total === 3 && all.json.items.every((i: { userEmail: string; organizationName: string }) => i.userEmail && i.organizationName), all.json);
    const fromBia = all.json.items.find((i: { id: string }) => i.id === first.id);
    check("author and organization are the right ones", fromBia?.userEmail === "bia@example.com" && fromBia.userName === "Bia Lima" && fromBia.organizationId === ana.organizationId && fromBia.organizationName === "Portfólio de Ana", fromBia);
    check("latest first", all.json.items[0].createdAt >= all.json.items[2].createdAt);
    check("pagination", (await admin.call("GET", "/api/admin/feedback?page=2&pageSize=2")).json?.items?.length === 1);

    const resolved = await admin.call("PATCH", `/api/admin/feedback/${first.id}`, { status: "resolved" });
    check("resolve -> 200", resolved.status === 200 && resolved.json.status === "resolved", resolved);
    check("filter by status on the admin list", (await admin.call("GET", "/api/admin/feedback?status=open")).json?.total === 2 && (await admin.call("GET", "/api/admin/feedback?status=resolved")).json?.total === 1);
    check("the author sees the new status", (await bia.session.call("GET", "/api/feedback")).json?.items?.[0]?.status === "resolved");
    check("it can be reopened", (await admin.call("PATCH", `/api/admin/feedback/${first.id}`, { status: "open" })).json?.status === "open");
    check("invalid status -> 400", (await admin.call("PATCH", `/api/admin/feedback/${first.id}`, { status: "done" })).status === 400);
    check("unknown feedback -> 404", (await admin.call("PATCH", "/api/admin/feedback/00000000-0000-4000-8000-000000000000", { status: "resolved" })).status === 404);
    check("non-uuid id -> 400", (await admin.call("PATCH", "/api/admin/feedback/xyz", { status: "resolved" })).status === 400);
  });

  it("impersonates a user without being able to delete", async () => {
    const start = await admin.call("POST", "/api/auth/admin/impersonate-user", { userId: bia.userId });
    check("impersonate -> 200", start.status === 200, start);

    const me = await admin.call("GET", "/api/me");
    check("the session now belongs to the impersonated user and says who is behind it", me.json?.user?.id === bia.userId && me.json.impersonatedById === adminId, me.json);
    const property = await admin.call("POST", "/api/properties", { name: "Criado em nome da Bia", propertyType: "residential", usageType: "rental" });
    check("creating still works while impersonating", property.status === 201, property);
    check("editing still works", (await admin.call("PATCH", `/api/properties/${property.json.id}`, { name: "Renomeado" })).status === 200);
    const blocked = await admin.call("DELETE", `/api/properties/${property.json.id}`);
    check("deleting is blocked (403)", blocked.status === 403 && blocked.json?.error?.code === "FORBIDDEN", blocked);
    check("the property is still there", (await prisma.property.count({ where: { id: property.json.id } })) === 1);
    check("the operator panel is closed while impersonating a non-admin", (await admin.call("GET", "/api/admin/feedback")).status === 403);

    const stop = await admin.call("POST", "/api/auth/admin/stop-impersonating", {});
    check("stop impersonating -> 200", stop.status === 200, stop);
    const back = await admin.call("GET", "/api/me");
    check("back to the admin's own session", back.json?.user?.id === adminId && back.json.impersonatedById === null, back.json);
    check("the operator panel works again", (await admin.call("GET", "/api/admin/feedback")).status === 200);
    const own = await admin.call("POST", "/api/properties", { name: "Da própria admin", propertyType: "residential", usageType: "rental" });
    check("and deleting is allowed again", own.status === 201 && (await admin.call("DELETE", `/api/properties/${own.json.id}`)).status === 204);
  });
});
