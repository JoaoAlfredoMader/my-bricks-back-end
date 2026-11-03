import { afterAll, beforeAll, describe, it } from "vitest";
import { createContainer } from "../../src/container.js";
import { runMaintenance } from "../../src/modules/maintenance/maintenance.js";
import { check } from "../helpers/check.js";
import { MIME, PNG } from "../helpers/fixtures.js";
import { Session, env, prisma, resetDatabase, storage } from "../helpers/world.js";

/**
 * The only tests that wire the app WITH the sample portfolio, the way the server runs: a guest
 * signs in and finds a workspace worth exploring.
 */
describe("Guest workspace with the sample portfolio", () => {
  const demoApp = createContainer(env);
  let guest: Session;
  let organizationId: string;
  let guestId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let centro: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let flat: any;

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await demoApp.prisma.$disconnect();
    await prisma.$disconnect();
  });

  it("fills the demo workspace when a guest signs in", async () => {
    guest = new Session(demoApp.app);
    check("anonymous sign-in -> 200", (await guest.call("POST", "/api/auth/sign-in/anonymous")).status === 200);
    const me = await guest.call("GET", "/api/me");
    organizationId = me.json.organizationId;
    guestId = me.json.user.id;
    check("the guest works in a demo organization that expires", me.json.user.isAnonymous === true && (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).isDemo === true);

    const counts = {
      properties: await prisma.property.count({ where: { organizationId } }),
      clients: await prisma.client.count({ where: { organizationId } }),
      agencies: await prisma.agency.count({ where: { organizationId } }),
      occupants: await prisma.occupant.count({ where: { organizationId } }),
      contracts: await prisma.contract.count({ where: { organizationId } }),
      reservations: await prisma.reservation.count({ where: { organizationId } }),
      transactions: await prisma.transaction.count({ where: { organizationId } }),
    };
    check("the sample portfolio is there", counts.properties === 9 && counts.clients === 3 && counts.agencies === 1 && counts.occupants === 11 && counts.contracts === 4 && counts.reservations === 8 && counts.transactions === 6, counts);
    check("everything is authored by the guest, who is a member of the organization", (await prisma.property.count({ where: { organizationId, createdById: guestId } })) === 9 && (await prisma.client.count({ where: { organizationId, createdById: guestId } })) === 3);
  });

  it("is a working workspace for every module of the API", async () => {
    const properties = await guest.call("GET", "/api/properties?pageSize=100");
    check("properties list", properties.status === 200 && properties.json.total === 9, properties.json?.total);
    centro = properties.json.items.find((p: { name: string }) => p.name === "Apartamento Centro");
    flat = properties.json.items.find((p: { name: string }) => p.name === "Flat Beira-Mar");
    const statuses = properties.json.items.map((p: { status: string }) => p.status);
    check("there are rented, vacant and own-use properties", statuses.includes("rented") && statuses.includes("vacant") && statuses.includes("own_use"), statuses);
    check("a property comes with address, financing, legal record, insurance and an owner", centro?.address?.city === "São Paulo" && centro.financing?.amortizationSystem === "sac" && centro.legalRecord?.registrationStatus === "regular" && centro.insurance !== null && centro.clientId !== null && centro.agencyName === "Imobiliária Central", centro);

    check("clients list", (await guest.call("GET", "/api/clients")).json?.total === 3);
    check("agencies list", (await guest.call("GET", "/api/agencies")).json?.total === 1);
    check("occupants list", (await guest.call("GET", "/api/occupants?pageSize=100")).json?.total === 11);
    const contracts = await guest.call("GET", "/api/contracts?pageSize=100");
    check("contracts: 4, one ended and the rest active", contracts.json?.total === 4 && contracts.json.items.filter((c: { status: string }) => c.status === "ended").length === 1, contracts.json?.items?.map((c: { status: string }) => c.status));
    const reservations = await guest.call("GET", "/api/reservations?pageSize=100");
    check("reservations: 8, one cancelled", reservations.json?.total === 8 && reservations.json.items.filter((r: { status: string }) => r.status === "cancelled").length === 1);
    check("transactions: 6, expenses and a revenue", (await guest.call("GET", "/api/transactions?type=revenue")).json?.total === 1 && (await guest.call("GET", "/api/transactions?type=expense")).json?.total === 5);
    check("proposals of a property", (await guest.call("GET", `/api/properties/${centro.id}/proposals`)).json?.total === 1);

    const schedule = await guest.call("GET", `/api/properties/${centro.id}/financing-schedule`);
    check("the financing schedule has 360 installments, some already paid", schedule.status === 200 && schedule.json.installments.length === 360 && schedule.json.summary.paidInstallments > 60, schedule.json?.summary);
  });

  it("produces real indicators", async () => {
    const portfolio = (await guest.call("GET", "/api/kpis/portfolio")).json;
    check("portfolio: 9 properties and a patrimony of the right order", portfolio?.propertyCount === 9 && portfolio.totals.totalValueCents > 600_000_000, portfolio?.totals);
    check("positive income and a plausible cap rate (2% to 15%)", portfolio?.totals?.noiCents > 0 && portfolio.totals.capRate > 0.02 && portfolio.totals.capRate < 0.15, portfolio?.totals);
    const byName = Object.fromEntries(portfolio.properties.map((p: { name: string }) => [p.name, p]));
    check("the contract property earns the contract rent", byName["Apartamento Centro"].revenueSource === "contract" && byName["Apartamento Centro"].monthlyRentCents === 380_000, byName["Apartamento Centro"]);
    check("the short-stay flat earns from its bookings in the last 12 months", byName["Flat Beira-Mar"].revenueSource === "reservations" && byName["Flat Beira-Mar"].annualRevenueCents > 0, byName["Flat Beira-Mar"]);
    check("the vacant apartment earns nothing but still costs", byName["Apartamento Vila Mariana"].annualRevenueCents === 0 && byName["Apartamento Vila Mariana"].noiCents < 0);
    check("own-use properties are left out of the income", byName["Casa de Praia"].includedInPortfolio === false && byName["Terreno Atibaia"].includedInPortfolio === false);
    check("IRR is available where there is an acquisition", byName["Apartamento Centro"].irr.annualRate !== null && byName["Galpão Logístico Anhanguera"].irr.annualRate !== null, [byName["Apartamento Centro"].irr, byName["Galpão Logístico Anhanguera"].irr]);
  });

  it("can be changed freely, and a PDF can be generated from it", async () => {
    check("the guest can create records on top of the sample", (await guest.call("POST", "/api/clients", { name: "Cliente do Convidado" })).status === 201);
    check("and edit and delete the sample ones", (await guest.call("PATCH", `/api/properties/${centro.id}`, { notes: "Anotação do convidado" })).json?.notes === "Anotação do convidado");
    const contract = (await guest.call("GET", `/api/contracts?propertyId=${centro.id}&status=active`)).json.items[0];
    const pdf = await guest.call("POST", `/api/contracts/${contract.id}/pdf`);
    check("a contract PDF can be generated from the sample contract", pdf.status === 200 && pdf.json.sizeBytes > 1000, pdf);
    const photo = await guest.upload(`/api/properties/${centro.id}/photos`, { name: "fachada.png", type: MIME.png, bytes: PNG });
    check("and a photo uploaded", photo.status === 201, photo);
  });

  it("keeps the sample portfolio when the guest signs up for real", async () => {
    const signUp = await guest.call("POST", "/api/auth/sign-up/email", { name: "Bruno Lima", email: "bruno@example.com", password: "outra-senha-123" });
    check("sign-up -> 200", signUp.status === 200, signUp);
    const me = await guest.call("GET", "/api/me");
    check("the same organization, now permanent", me.json?.organizationId === organizationId && (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).isDemo === false);
    check("with all the data and the new user as the author", (await guest.call("GET", "/api/properties?pageSize=100")).json?.total === 9 && (await prisma.property.count({ where: { organizationId, createdById: me.json.user.id } })) === 9);
    check("so the maintenance leaves it alone", (await runMaintenance({ prisma, storage, now: new Date(Date.now() + 30 * 86_400_000) })).expiredDemoOrganizations === 0 && (await prisma.property.count({ where: { organizationId } })) === 9);
  });

  it("is removed, with its files, when an untouched guest workspace expires", async () => {
    const other = new Session(demoApp.app);
    await other.call("POST", "/api/auth/sign-in/anonymous");
    const me = await other.call("GET", "/api/me");
    const orgId = me.json.organizationId as string;
    const properties = (await other.call("GET", "/api/properties?pageSize=1")).json.items[0];
    const photo = await other.upload(`/api/properties/${properties.id}/photos`, { name: "a.png", type: MIME.png, bytes: PNG });
    const key = (await prisma.storedFile.findFirstOrThrow({ where: { organizationId: orgId } })).storageKey;
    check("(setup) the second guest has data and a file", photo.status === 201 && (await storage.get(key)) !== null);

    await prisma.organization.update({ where: { id: orgId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });
    const report = await runMaintenance({ prisma, storage });
    check("the report counts the organization and the guest account", report.expiredDemoOrganizations === 1 && report.anonymousUsersRemoved === 1, report);
    check("every row of the sample portfolio is gone", (await prisma.organization.count({ where: { id: orgId } })) === 0 && (await prisma.property.count({ where: { organizationId: orgId } })) === 0 && (await prisma.client.count({ where: { organizationId: orgId } })) === 0 && (await prisma.occupant.count({ where: { organizationId: orgId } })) === 0 && (await prisma.agency.count({ where: { organizationId: orgId } })) === 0 && (await prisma.storedFile.count({ where: { organizationId: orgId } })) === 0);
    check("so is the uploaded object", (await storage.get(key)) === null);
    check("and the guest account with its sessions", (await prisma.user.count({ where: { id: me.json.user.id } })) === 0 && (await prisma.session.count({ where: { userId: me.json.user.id } })) === 0);
    check("the guest's cookie no longer opens anything (401)", (await other.call("GET", "/api/me")).status === 401);
  });
});
