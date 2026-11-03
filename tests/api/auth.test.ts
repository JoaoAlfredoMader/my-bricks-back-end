import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { Session, app, env, prisma, resetDatabase } from "../helpers/world.js";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Authentication API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, meAna: any, ana2: any, guest: any, demo: any, guestId: any, demoId: any, property: any, after: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("unauthenticated", async () => {
    const anon = new Session();
    const unauth = await anon.call("GET", "/api/me");
    check("GET /api/me without session -> 401 with typed error", unauth.status === 401 && unauth.json?.error?.code === "UNAUTHENTICATED", unauth);
  });

  it("email sign-up provisions a personal organization and activates it", async () => {
    ana = new Session();
    const signUp = await ana.call("POST", "/api/auth/sign-up/email", { name: "Ana Souza", email: "ana@example.com", password: "senha-forte-123" });
    check("sign-up e-mail -> 200", signUp.status === 200, signUp);
    meAna = await ana.call("GET", "/api/me");
    check("/api/me after sign-up -> 200", meAna.status === 200, meAna);
    check("personal organization active", Boolean(meAna.json?.organizationId), meAna.json);
    check("member role is owner", meAna.json?.memberRole === "owner", meAna.json);
    check("not anonymous, platform role user", meAna.json?.user?.isAnonymous === false && meAna.json?.user?.platformRole === "user", meAna.json?.user);
    const orgAna = await prisma.organization.findUnique({ where: { id: meAna.json?.organizationId } });
    check("organization named after the user, not demo", orgAna?.name === "Portfólio de Ana" && orgAna.isDemo === false, orgAna);
  });

  it("sign-in works and keeps the organization", async () => {
    ana2 = new Session();
    const signIn = await ana2.call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-forte-123" });
    check("sign-in e-mail -> 200", signIn.status === 200, signIn);
    const me2 = await ana2.call("GET", "/api/me");
    check("sign-in session gets the same active organization", me2.json?.organizationId === meAna.json?.organizationId, me2.json);
    const wrong = await new Session().call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "errada-errada" });
    check("wrong password rejected", wrong.status === 401 || wrong.status === 400, wrong.status);
  });

  it("guest gets an expiring demo workspace", async () => {
    guest = new Session();
    const g = await guest.call("POST", "/api/auth/sign-in/anonymous");
    check("anonymous sign-in -> 200", g.status === 200, g);
    const meGuest = await guest.call("GET", "/api/me");
    check("guest flagged anonymous", meGuest.json?.user?.isAnonymous === true, meGuest.json);
    demo = await prisma.organization.findUnique({ where: { id: meGuest.json?.organizationId } });
    check("guest workspace is a demo that expires", demo?.isDemo === true && demo.demoExpiresAt !== null && demo.demoExpiresAt.getTime() > Date.now(), demo);
    const ttlHours = demo?.demoExpiresAt ? (demo.demoExpiresAt.getTime() - Date.now()) / 3_600_000 : 0;
    check("demo TTL close to DEMO_TTL_HOURS", ttlHours > env.DEMO_TTL_HOURS - 0.1 && ttlHours <= env.DEMO_TTL_HOURS, ttlHours);

    // guest creates data (directly, there are no domain routes yet)
    guestId = meGuest.json.user.id as string;
    demoId = meGuest.json.organizationId as string;
    property = await prisma.property.create({
      data: { organizationId: demoId, createdById: guestId, name: "Imóvel do convidado", propertyType: "residential", usageType: "rental" },
    });
  });

  it("guest signs up for real: workspace is adopted", async () => {
    const link = await guest.call("POST", "/api/auth/sign-up/email", { name: "Bruno Lima", email: "bruno@example.com", password: "outra-senha-123" });
    check("guest -> real account sign-up -> 200", link.status === 200, link);
    const meBruno = await guest.call("GET", "/api/me");
    check("linked user is no longer anonymous", meBruno.json?.user?.isAnonymous === false && meBruno.json?.user?.email === "bruno@example.com", meBruno.json);
    check("adopted the demo organization", meBruno.json?.organizationId === demoId, { got: meBruno.json?.organizationId, demoId });
    const adopted = await prisma.organization.findUnique({ where: { id: demoId } });
    check("adopted organization is permanent and renamed", adopted?.isDemo === false && adopted.demoExpiresAt === null && adopted.name === "Portfólio de Bruno", adopted);
    const moved = await prisma.property.findUnique({ where: { id: property.id } });
    check("authorship followed to the new user (ON UPDATE CASCADE)", moved?.createdById === meBruno.json?.user?.id, moved);
    const brunoOrgs = await prisma.member.count({ where: { userId: meBruno.json?.user?.id } });
    check("new user has exactly one organization", brunoOrgs === 1, brunoOrgs);
    check("anonymous user was deleted", (await prisma.user.count({ where: { id: guestId } })) === 0);
    check("member role is owner after adoption", meBruno.json?.memberRole === "owner", meBruno.json);
  });

  it("invitation as a copyable link", async () => {
    const invite = await ana.call("POST", "/api/auth/organization/invite-member", { email: "carla@example.com", role: "member", organizationId: meAna.json.organizationId });
    check("owner creates invitation -> 200 with id", invite.status === 200 && typeof invite.json?.id === "string", invite);
    const carla = new Session();
    await carla.call("POST", "/api/auth/sign-up/email", { name: "Carla Dias", email: "carla@example.com", password: "senha-da-carla-1" });
    const accept = await carla.call("POST", "/api/auth/organization/accept-invitation", { invitationId: invite.json?.id });
    check("invitee accepts the invitation -> 200", accept.status === 200, accept);
    const setActive = await carla.call("POST", "/api/auth/organization/set-active", { organizationId: meAna.json.organizationId });
    check("invitee switches active organization", setActive.status === 200, setActive);
    const meCarla = await carla.call("GET", "/api/me");
    check("invitee works in Ana's organization as member", meCarla.json?.organizationId === meAna.json.organizationId && meCarla.json?.memberRole === "member", meCarla.json);
  });

  it("admin plugin: platform role", async () => {
    const denied = await ana.call("GET", "/api/auth/admin/list-users?limit=5");
    check("normal user cannot use admin endpoints", denied.status === 403 || denied.status === 401, denied.status);
    await prisma.user.update({ where: { email: "ana@example.com" }, data: { role: "admin" } });
    const ana3 = new Session();
    await ana3.call("POST", "/api/auth/sign-in/email", { email: "ana@example.com", password: "senha-forte-123" });
    const listed = await ana3.call("GET", "/api/auth/admin/list-users?limit=10");
    check("platform admin can list users", listed.status === 200 && Array.isArray(listed.json?.users), listed.status);
    const meAdmin = await ana3.call("GET", "/api/me");
    check("platform role exposed in /api/me", meAdmin.json?.user?.platformRole === "admin", meAdmin.json?.user);
  });

  it("CORS", async () => {
    const pre = await app.request("/api/me", { method: "OPTIONS", headers: { origin: env.FRONTEND_URL, "access-control-request-method": "GET" } });
    check("CORS preflight allows the front-end origin with credentials", pre.headers.get("access-control-allow-origin") === env.FRONTEND_URL && pre.headers.get("access-control-allow-credentials") === "true", Object.fromEntries(pre.headers));
    // Better Auth skips its own origin check when NODE_ENV=test, so only the app-level CORS is covered here.
    const evil = await app.request("/api/me", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    check("CORS preflight does not allow an untrusted origin", evil.headers.get("access-control-allow-origin") !== "https://evil.example", Object.fromEntries(evil.headers));
  });

  it("sign-out invalidates the session", async () => {
    const out = await ana2.call("POST", "/api/auth/sign-out", {});
    check("sign-out -> 200", out.status === 200, out);
    after = await ana2.call("GET", "/api/me");
    check("session invalid after sign-out", after.status === 401, after.status);
  });
});
