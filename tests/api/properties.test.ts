import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type ApiResponse, Session, prisma, resetDatabase, signUp } from "../helpers/world.js";



/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Properties API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, cities: any, campinas: any, residential: any, land: any, disallowed: any, apartment: any, farm: any, clientAna: any, clientCarlos: any, k: any, apto: any, stored: any, parking: any, base: any, contract: any, attached: any, deleted: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("sets up the scenario", async () => {
    const anon = new Session();
    check("properties without session -> 401", (await anon.call("GET", "/api/properties")).status === 401);
    check("cities without session -> 401", (await anon.call("GET", "/api/lookups/cities?search=campinas")).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });
  });

  it("lookups", async () => {
    cities = await ana.session.call("GET", "/api/lookups/cities?search=campinas&state=sp");
    campinas = cities.json?.find((c: any) => c.name === "Campinas");
    check("city search by name and state (case-insensitive)", cities.status === 200 && campinas?.state === "SP", cities);
    check("city search needs at least 2 characters", (await ana.session.call("GET", "/api/lookups/cities?search=c")).status === 400);
    check("city search honors the limit and ignores accents", (await ana.session.call("GET", "/api/lookups/cities?search=sao&limit=3")).json?.length === 3);
    check("city search treats % literally", (await ana.session.call("GET", "/api/lookups/cities?search=%25%25")).json?.length === 0);
    const catalog = await ana.session.call("GET", "/api/lookups/property-catalog");
    residential = catalog.json?.find((e: any) => e.propertyType === "residential");
    check("catalog lists the 6 property types", catalog.status === 200 && catalog.json.length === 6, catalog.json?.length);
    check("catalog entry has subtypes and usages", residential?.subtypes?.length > 0 && residential.usageTypes.includes("rental"), residential);
    land = catalog.json.find((e: any) => e.propertyType === "land");
    disallowed = ["rental", "short_stay", "agricultural_lease", "concession", "own_use", "loan_for_use"].find((u) => !land.usageTypes.includes(u))!;
    apartment = residential.subtypes.find((s: any) => s.name === "Apartamento");
    farm = catalog.json.find((e: any) => e.propertyType === "rural").subtypes[0];
  });

  it("clients to attach", async () => {
    clientAna = (await ana.session.call("POST", "/api/clients", { name: "Maria Oliveira" })).json;
    clientCarlos = (await carlos.session.call("POST", "/api/clients", { name: "Cliente do Carlos" })).json;
  });

  it("create", async () => {
    const minimal = await ana.session.call("POST", "/api/properties", { name: "Kitnet Centro", propertyType: "residential", usageType: "rental" });
    check("create with the minimum -> 201", minimal.status === 201, minimal);
    k = minimal.json;
    check("defaults: 100% ownership, 90% occupancy, manual mode, no expenses",
      k?.ownershipPercentage === 100 && k.occupancyRate === 90 && k.rentalMode === "manual" && k.annualExpensesCents === 0, k);
    check("minimal property is vacant, without address or rental", k?.status === "vacant" && k.address === null && k.manualRental === null, k);
    check("authorship is the caller", k?.createdById === ana.userId, k);

    const full = await ana.session.call("POST", "/api/properties", {
      name: "Apto 42", propertyType: "residential", subtypeId: apartment.id, usageType: "rental",
      ownershipPercentage: 50, totalArea: 85.5, privateArea: 70, bedrooms: 3, suites: 1, bathrooms: 2, parkingSpaces: 1,
      builtYear: 2015, conservationState: "good", estimatedValueCents: 85_000_000, annualExpensesCents: 1_200_000,
      occupancyRate: 95, notes: "Perto do metrô", clientId: clientAna.id,
      address: { cityId: campinas.ibgeCode, postalCode: "13015904", street: "Rua Barão de Jaguara", number: "100", complement: "", neighborhood: "Centro" },
      manualRental: { tenantName: "João Inquilino", monthlyRentCents: 350_000, dueDay: 5 },
    });
    check("create full property -> 201", full.status === 201, full);
    apto = full.json;
    check("money comes back as integer cents", apto?.estimatedValueCents === 85_000_000 && apto.annualExpensesCents === 1_200_000 && apto.manualRental?.monthlyRentCents === 350_000, apto);
    check("decimals come back as numbers", apto?.ownershipPercentage === 50 && apto.totalArea === 85.5 && apto.occupancyRate === 95, apto);
    check("address resolved with city and state, postal code formatted, blank complement null",
      apto?.address?.city === "Campinas" && apto.address.state === "SP" && apto.address.postalCode === "13015-904" && apto.address.complement === null, apto?.address);
    check("manual rental with tenant -> rented", apto?.status === "rented" && apto.manualRental.dueDay === 5, apto);
    check("client attached", apto?.clientId === clientAna.id, apto);
    stored = await prisma.property.findUnique({ where: { id: apto.id } });
    check("stored in the caller's organization", stored?.organizationId === ana.organizationId);

    const ownUse = await ana.session.call("POST", "/api/properties", {
      name: "Casa de praia", propertyType: "residential", usageType: "own_use", manualRental: { monthlyRentCents: 100_000 },
    });
    check("own use stays own_use even with rent data", ownUse.status === 201 && ownUse.json.status === "own_use", ownUse);
    const loan = await ana.session.call("POST", "/api/properties", { name: "Casa da mãe", propertyType: "residential", usageType: "loan_for_use" });
    check("loan for use keeps its status", loan.json?.status === "loan_for_use", loan);
    const rentOnly = await ana.session.call("POST", "/api/properties", {
      name: "Sala 3", propertyType: "commercial", usageType: "rental", manualRental: { monthlyRentCents: 200_000 },
    });
    check("rent without a tenant name -> rented", rentOnly.json?.status === "rented", rentOnly);
    const emptyRental = await ana.session.call("POST", "/api/properties", {
      name: "Sala 4", propertyType: "commercial", usageType: "rental", manualRental: { monthlyRentCents: 0 },
    });
    check("empty manual rental -> vacant", emptyRental.json?.status === "vacant", emptyRental);
    parking = await ana.session.call("POST", "/api/properties", {
      name: "Vaga 12", propertyType: "parking", usageType: "rental", parkingSpotLabel: "B-12",
    });
    check("parking spot label allowed on parking", parking.status === 201 && parking.json.parkingSpotLabel === "B-12", parking);
  });

  it("validation", async () => {
    const bad = (name: string, body: unknown, path?: string) =>
      ana.session.call("POST", "/api/properties", body).then((r: ApiResponse) => {
        check(name, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR" && (!path || r.json.error.details.some((d: any) => d.path === path)), r);
      });
    base = { name: "Teste", propertyType: "residential", usageType: "rental" };
    await bad("usage not allowed for the type -> 400", { name: "Terreno", propertyType: "land", usageType: disallowed }, "usageType");
    await bad("subtype of another type -> 400", { ...base, subtypeId: farm.id }, "subtypeId");
    await bad("unknown subtype -> 400", { ...base, subtypeId: 999999 }, "subtypeId");
    await bad("parking label on a residential property -> 400", { ...base, parkingSpotLabel: "A1" }, "parkingSpotLabel");
    await bad("ownership of 0 -> 400", { ...base, ownershipPercentage: 0 });
    await bad("ownership above 100 -> 400", { ...base, ownershipPercentage: 100.5 });
    await bad("occupancy above 100 -> 400", { ...base, occupancyRate: 101 });
    await bad("negative cents -> 400", { ...base, annualExpensesCents: -1 });
    await bad("fractional cents -> 400", { ...base, estimatedValueCents: 10.5 });
    await bad("invalid postal code -> 400", { ...base, address: { cityId: campinas.ibgeCode, street: "Rua A", postalCode: "123" } });
    await bad("address without street -> 400", { ...base, address: { cityId: campinas.ibgeCode } });
    await bad("unknown city -> 400", { ...base, address: { cityId: 1, street: "Rua A" } }, "address.cityId");
    await bad("unknown client -> 400", { ...base, clientId: "00000000-0000-4000-8000-000000000000" }, "clientId");
    await bad("client of another organization -> 400", { ...base, clientId: clientCarlos.id }, "clientId");
    await bad("manual rental in contract mode -> 400", { ...base, rentalMode: "contract", manualRental: { monthlyRentCents: 1 } }, "manualRental");
    await bad("due day 32 -> 400", { ...base, manualRental: { dueDay: 32 } });
    await bad("unknown property type -> 400", { ...base, propertyType: "castle" });
    check("failed creates left nothing behind", (await prisma.property.count({ where: { name: "Teste" } })) === 0);
  });

  it("list", async () => {
    const list = await ana.session.call("GET", "/api/properties");
    check("list returns all 7 sorted by name", list.json?.total === 7 && list.json.items[0].name === "Apto 42", list.json?.items?.map((i: any) => i.name));
    check("list includes address and status", list.json?.items?.find((i: any) => i.id === apto.id)?.address?.city === "Campinas");
    check("search by name", (await ana.session.call("GET", "/api/properties?search=sala")).json?.total === 2);
    check("filter by property type", (await ana.session.call("GET", "/api/properties?propertyType=commercial")).json?.total === 2);
    check("filter by usage type", (await ana.session.call("GET", "/api/properties?usageType=own_use")).json?.total === 1);
    check("filter by client", (await ana.session.call("GET", `/api/properties?clientId=${clientAna.id}`)).json?.total === 1);
    const paged = await ana.session.call("GET", "/api/properties?page=2&pageSize=3");
    check("pagination", paged.json?.items?.length === 3 && paged.json.total === 7 && paged.json.page === 2, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/properties?pageSize=500")).status === 400);
  });

  it("get / patch", async () => {
    check("get by id", (await ana.session.call("GET", `/api/properties/${apto.id}`)).json?.name === "Apto 42");
    check("unknown id -> 404", (await ana.session.call("GET", "/api/properties/00000000-0000-4000-8000-000000000000")).status === 404);

    const renamed = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { name: "Apto 42 B", notes: null, bedrooms: null });
    check("patch changes only what was sent", renamed.json?.name === "Apto 42 B" && renamed.json.notes === null && renamed.json.bedrooms === null && renamed.json.bathrooms === 2 && renamed.json.address?.city === "Campinas", renamed);
    check("empty patch -> 400", (await ana.session.call("PATCH", `/api/properties/${apto.id}`, {})).status === 400);
    const disallowedPatch = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { propertyType: "land" });
    check("changing the type while the usage/subtype no longer fit -> 400", disallowedPatch.status === 400, disallowedPatch);
    const toParking = await ana.session.call("PATCH", `/api/properties/${k.id}`, { propertyType: "parking", usageType: "rental", subtypeId: null, parkingSpotLabel: "C-1" });
    check("changing type together with dependent fields works", toParking.status === 200 && toParking.json.propertyType === "parking", toParking);
    const labelOnResidential = await ana.session.call("PATCH", `/api/properties/${parking.json.id}`, { propertyType: "residential" });
    check("leaving parking while a spot label remains -> 400", labelOnResidential.status === 400, labelOnResidential);
    const unknownClient = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { clientId: clientCarlos.id });
    check("patching in another organization's client -> 400", unknownClient.status === 400, unknownClient);
    const detached = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { clientId: null });
    check("client can be detached", detached.json?.clientId === null, detached);

    const moved = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { address: { cityId: campinas.ibgeCode, street: "Av. Brasil", number: "S/N" } });
    check("address is replaced as a whole", moved.json?.address?.street === "Av. Brasil" && moved.json.address.neighborhood === null && moved.json.address.postalCode === null, moved.json?.address);
    const noAddress = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { address: null });
    check("address can be removed", noAddress.json?.address === null, noAddress);
    const addressBack = await ana.session.call("PATCH", `/api/properties/${k.id}`, { address: { cityId: campinas.ibgeCode, street: "Rua Nova" } });
    check("address can be added later", addressBack.json?.address?.street === "Rua Nova", addressBack);

    const vacated = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { manualRental: { tenantName: "", monthlyRentCents: 0 } });
    check("clearing tenant and rent -> vacant", vacated.json?.status === "vacant" && vacated.json.manualRental.tenantName === null, vacated);
    const rentedAgain = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { manualRental: { tenantName: "Nova Inquilina", monthlyRentCents: 400_000, dueDay: 10 } });
    check("new tenant -> rented", rentedAgain.json?.status === "rented" && rentedAgain.json.manualRental.monthlyRentCents === 400_000, rentedAgain);

    // contract mode: status follows the active contract
    const toContract = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { rentalMode: "contract" });
    check("contract mode without an active contract -> vacant", toContract.status === 200 && toContract.json.status === "vacant", toContract);
    const occupant = await prisma.occupant.create({ data: { organizationId: ana.organizationId, name: "Locatário Contrato" } });
    contract = await prisma.contract.create({
      data: {
        organizationId: ana.organizationId, propertyId: apto.id, occupantId: occupant.id, contractType: "conventional",
        startDate: new Date("2026-01-01"), rentTerms: { create: { monthlyRentCents: 500_000n, dueDay: 5 } },
      },
    });
    check("active contract -> rented", (await ana.session.call("GET", `/api/properties/${apto.id}`)).json?.status === "rented");
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "ended" } });
    check("ended contract -> vacant again", (await ana.session.call("GET", `/api/properties/${apto.id}`)).json?.status === "vacant");
    const contractWithRental = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { manualRental: { monthlyRentCents: 1 } });
    check("sending manual rental while in contract mode -> 400", contractWithRental.status === 400, contractWithRental);
    const backToManual = await ana.session.call("PATCH", `/api/properties/${apto.id}`, { rentalMode: "manual" });
    check("back to manual mode keeps the stored manual rental", backToManual.json?.manualRental?.tenantName === "Nova Inquilina" && backToManual.json.status === "rented", backToManual);
  });

  it("acquisition", async () => {
    const bought = await ana.session.call("POST", "/api/properties", { name: "Comprado", propertyType: "residential", usageType: "rental", acquisition: { acquisitionType: "purchase", acquiredOn: "2020-03-15", costCents: 60_000_000 } });
    check("create with an acquisition", bought.status === 201 && bought.json.acquisition?.acquisitionType === "purchase" && bought.json.acquisition.acquiredOn === "2020-03-15" && bought.json.acquisition.costCents === 60_000_000, bought);
    const noDate = await ana.session.call("POST", "/api/properties", { name: "Herdado", propertyType: "residential", usageType: "rental", acquisition: { acquisitionType: "inheritance" } });
    check("an inheritance without a base date -> 400", noDate.status === 400 && noDate.json.error.details.some((d: any) => d.path === "acquisition.acquiredOn"), noDate);
    const inherited = await ana.session.call("PATCH", `/api/properties/${bought.json.id}`, { acquisition: { acquisitionType: "inheritance", acquiredOn: "2018-01-10" } });
    check("acquisition is replaced as a whole (cost cleared)", inherited.json?.acquisition?.acquisitionType === "inheritance" && inherited.json.acquisition.costCents === null && inherited.json.acquisition.acquiredOn === "2018-01-10", inherited);
    const withoutAcq = await ana.session.call("PATCH", `/api/properties/${bought.json.id}`, { acquisition: null });
    check("acquisition can be removed", withoutAcq.json?.acquisition === null, withoutAcq);
    check("properties without acquisition expose null", k.acquisition === null);
  });

  it("members only see what they created", async () => {
    const biaProperty = await bia.session.call("POST", "/api/properties", { name: "Imóvel da Bia", propertyType: "residential", usageType: "rental" });
    check("member creates a property", biaProperty.status === 201 && biaProperty.json.createdById === bia.userId, biaProperty);
    const biaList = await bia.session.call("GET", "/api/properties");
    check("member lists only her own", biaList.json?.total === 1 && biaList.json.items[0].id === biaProperty.json.id, biaList.json);
    check("member cannot read another member's property (404)", (await bia.session.call("GET", `/api/properties/${apto.id}`)).status === 404);
    check("member cannot update it (404)", (await bia.session.call("PATCH", `/api/properties/${apto.id}`, { name: "Hack Hack" })).status === 404);
    check("member cannot delete it (404)", (await bia.session.call("DELETE", `/api/properties/${apto.id}`)).status === 404);
    const biaWithAnaClient = await bia.session.call("POST", "/api/properties", { name: "Teste Bia", propertyType: "residential", usageType: "rental", clientId: clientAna.id });
    check("member cannot attach a client she cannot see -> 400", biaWithAnaClient.status === 400, biaWithAnaClient);
    check("owner sees everything", (await ana.session.call("GET", "/api/properties")).json?.total === 9);
  });

  it("tenant isolation", async () => {
    check("other organization cannot read (404)", (await carlos.session.call("GET", `/api/properties/${apto.id}`)).status === 404);
    check("other organization cannot update (404)", (await carlos.session.call("PATCH", `/api/properties/${apto.id}`, { name: "Hack Hack" })).status === 404);
    check("other organization cannot delete (404)", (await carlos.session.call("DELETE", `/api/properties/${apto.id}`)).status === 404);
    check("other organization lists nothing of ours", (await carlos.session.call("GET", "/api/properties")).json?.total === 0);
    check("property untouched after cross-tenant attempts", (await prisma.property.findUnique({ where: { id: apto.id } }))?.name === "Apto 42 B");
  });

  it("client deletion is blocked by properties, then released", async () => {
    const blocked = await ana.session.call("DELETE", `/api/clients/${clientAna.id}`);
    check("client with no property left can be deleted", blocked.status === 204, blocked);
    attached = await ana.session.call("PATCH", `/api/properties/${k.id}`, { clientId: (await ana.session.call("POST", "/api/clients", { name: "Novo Cliente" })).json.id });
    check("property attached to the new client", attached.status === 200 && attached.json.clientId !== null, attached);
    const stillBlocked = await ana.session.call("DELETE", `/api/clients/${attached.json.clientId}`);
    check("client that owns a property -> 409", stillBlocked.status === 409 && stillBlocked.json?.error?.details?.properties === 1, stillBlocked);
  });

  it("delete (cascades children)", async () => {
    deleted = await ana.session.call("DELETE", `/api/properties/${apto.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("deleted property is gone (404)", (await ana.session.call("GET", `/api/properties/${apto.id}`)).status === 404);
    check("delete twice -> 404", (await ana.session.call("DELETE", `/api/properties/${apto.id}`)).status === 404);
    const orphans =
      (await prisma.propertyAddress.count({ where: { propertyId: apto.id } })) +
      (await prisma.propertyManualRental.count({ where: { propertyId: apto.id } })) +
      (await prisma.contract.count({ where: { propertyId: apto.id } }));
    check("children were deleted with the property", orphans === 0, orphans);
  });
});
