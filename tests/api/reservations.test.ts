import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type ApiResponse, Session, prisma, resetDatabase, signUp } from "../helpers/world.js";

const CPF_1 = "529.982.247-25";
const CPF_2 = "168.995.350-09";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Reservations API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, flat: any, flat2: any, rental: any, biaFlat: any, carlosFlat: any, stayContract: any, otherFlatContract: any, conventional: any, guest: any, base: any, first: any, r1: any, overlap: any, clash: any, turnoverAfter: any, linked: any, outside: any, before: any, lastDay: any, link: any, cancelled: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("sets up the scenario", async () => {
    const anon = new Session();
    check("reservations without session -> 401", (await anon.call("GET", "/api/reservations")).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });

    const mkProperty = async (who: typeof ana, name: string, usageType: string, rentalMode = "manual") => {
      const r = await who.session.call("POST", "/api/properties", { name, propertyType: "residential", usageType, rentalMode });
      if (r.status !== 201) throw new Error(`property ${name}: ${JSON.stringify(r)}`);
      return r.json.id as string;
    };
    flat = await mkProperty(ana, "Flat Praia", "short_stay");
    flat2 = await mkProperty(ana, "Flat Serra", "short_stay");
    rental = await mkProperty(ana, "Apto Aluguel", "rental", "contract");
    biaFlat = await mkProperty(bia, "Flat da Bia", "short_stay");
    carlosFlat = await mkProperty(carlos, "Flat do Carlos", "short_stay");

    const mkContract = async (who: typeof ana, body: unknown) => {
      const r = await who.session.call("POST", "/api/contracts", body);
      if (r.status !== 201) throw new Error(`contract: ${JSON.stringify(r)}`);
      return r.json;
    };
    // short-stay contracts need the property in contract mode
    await ana.session.call("PATCH", `/api/properties/${flat}`, { rentalMode: "contract" });
    await ana.session.call("PATCH", `/api/properties/${flat2}`, { rentalMode: "contract" });
    stayContract = await mkContract(ana, { propertyId: flat, contractType: "short_stay", startDate: "2026-01-01", endDate: "2026-12-31", occupant: { name: "Administradora Temporada" } });
    otherFlatContract = await mkContract(ana, { propertyId: flat2, contractType: "short_stay", startDate: "2026-01-01", occupant: { name: "Administradora Serra" } });
    conventional = await mkContract(ana, {
      propertyId: rental, contractType: "conventional", startDate: "2026-01-01",
      rentTerms: { monthlyRentCents: 300_000, dueDay: 5 }, occupant: { name: "Inquilino Fixo" },
    });

    guest = { name: "Hóspede Um", document: CPF_1, email: "hospede@example.com", phone: "(21) 99999-0000" };
    base = { propertyId: flat, checkIn: "2026-03-10", checkOut: "2026-03-15", totalAmountCents: 120_000, occupant: guest };
  });

  it("create", async () => {
    first = await ana.session.call("POST", "/api/reservations", base);
    check("create reservation -> 201", first.status === 201, first);
    r1 = first.json;
    check("confirmed, dates as YYYY-MM-DD, nights derived", r1?.status === "confirmed" && r1.checkIn === "2026-03-10" && r1.checkOut === "2026-03-15" && r1.nights === 5, r1);
    check("money as integer cents, property name, no contract", r1?.totalAmountCents === 120_000 && r1.propertyName === "Flat Praia" && r1.contractId === null, r1);
    check("guest created and normalized", r1?.guest?.name === "Hóspede Um" && r1.guest.document === "52998224725" && r1.guest.phone === "21999990000", r1?.guest);
    const defaults = await ana.session.call("POST", "/api/reservations", { propertyId: flat, checkIn: "2026-04-01", checkOut: "2026-04-02", occupant: undefined, occupantId: r1.guest.id });
    check("total defaults to 0 and an existing guest is reused by id", defaults.status === 201 && defaults.json.totalAmountCents === 0 && defaults.json.guest.id === r1.guest.id, defaults);
  });

  it("validation", async () => {
    const bad = (name: string, body: unknown, path?: string) =>
      ana.session.call("POST", "/api/reservations", body).then((r: ApiResponse) => {
        check(name, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR" && (!path || r.json.error.details.some((d: any) => d.path === path)), r);
      });
    await bad("check-out not after check-in -> 400", { ...base, checkIn: "2026-05-01", checkOut: "2026-05-01" }, "checkOut");
    await bad("check-out before check-in -> 400", { ...base, checkIn: "2026-05-05", checkOut: "2026-05-01" }, "checkOut");
    await bad("neither occupantId nor occupant -> 400", { ...base, occupant: undefined }, "occupantId");
    await bad("both occupantId and occupant -> 400", { ...base, occupantId: r1.guest.id }, "occupantId");
    await bad("negative total -> 400", { ...base, checkIn: "2026-05-01", checkOut: "2026-05-02", totalAmountCents: -1 });
    await bad("fractional total -> 400", { ...base, checkIn: "2026-05-01", checkOut: "2026-05-02", totalAmountCents: 10.5 });
    await bad("impossible date -> 400", { ...base, checkIn: "2026-02-30" });
    await bad("non-uuid property -> 400", { ...base, propertyId: "x" });
    await bad("invalid guest document -> 400", { ...base, checkIn: "2026-05-01", checkOut: "2026-05-02", occupant: { name: "Fulano", document: "123.456.789-00" } });
    await bad("unknown guest id -> 400", { ...base, checkIn: "2026-05-01", checkOut: "2026-05-02", occupant: undefined, occupantId: "00000000-0000-4000-8000-000000000000" }, "occupantId");
    check("failed creates left nothing behind", (await prisma.reservation.count()) === 2 && (await prisma.occupant.count({ where: { name: "Fulano" } })) === 0);
  });

  it("business rules", async () => {
    const rentalRes = await ana.session.call("POST", "/api/reservations", { ...base, propertyId: rental });
    check("property without short-stay usage -> 422", rentalRes.status === 422 && rentalRes.json?.error?.code === "BUSINESS_RULE_VIOLATION", rentalRes);
    check("unknown property -> 404", (await ana.session.call("POST", "/api/reservations", { ...base, propertyId: "00000000-0000-4000-8000-000000000000" })).status === 404);
    check("another organization's property -> 404", (await ana.session.call("POST", "/api/reservations", { ...base, propertyId: carlosFlat })).status === 404);
  });

  it("overlap", async () => {
    overlap = (name: string, checkIn: string, checkOut: string) =>
      ana.session.call("POST", "/api/reservations", { ...base, checkIn, checkOut }).then((r: ApiResponse) => {
        check(name, r.status === 409 && r.json?.error?.code === "CONFLICT", r);
        return r;
      });
    clash = await overlap("same dates -> 409", "2026-03-10", "2026-03-15");
    check("conflict names the clashing reservation", clash.json?.error?.details?.reservationId === r1.id && clash.json.error.details.checkIn === "2026-03-10", clash.json);
    await overlap("overlapping the start -> 409", "2026-03-08", "2026-03-11");
    await overlap("overlapping the end -> 409", "2026-03-14", "2026-03-20");
    await overlap("inside an existing stay -> 409", "2026-03-11", "2026-03-13");
    await overlap("around an existing stay -> 409", "2026-03-01", "2026-03-30");
    turnoverAfter = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-03-15", checkOut: "2026-03-18", occupant: { name: "Hóspede Dois", document: CPF_2 } });
    check("same-day turnover after a stay is allowed", turnoverAfter.status === 201, turnoverAfter);
    const turnoverBefore = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-03-07", checkOut: "2026-03-10", occupant: undefined, occupantId: r1.guest.id });
    check("same-day turnover before a stay is allowed", turnoverBefore.status === 201, turnoverBefore);
    const otherProperty = await ana.session.call("POST", "/api/reservations", { ...base, propertyId: flat2, occupant: undefined, occupantId: r1.guest.id });
    check("same dates on another property are fine", otherProperty.status === 201, otherProperty);
  });

  it("concurrent requests for the same dates", async () => {
    const racers = await Promise.all([1, 2, 3].map((n) =>
      ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-08-01", checkOut: "2026-08-05", occupant: { name: `Corredor ${n}` } })));
    check("concurrent bookings: exactly one wins, the rest get 409", racers.filter((r) => r.status === 201).length === 1 && racers.filter((r) => r.status === 409).length === 2, racers.map((r) => [r.status, r.json?.error?.code]));
    check("concurrent bookings: one confirmed reservation in the database", (await prisma.reservation.count({ where: { propertyId: flat, checkIn: new Date("2026-08-01"), status: "confirmed" } })) === 1);
  });

  it("guest reuse", async () => {
    const sameDoc = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-09-01", checkOut: "2026-09-03", occupant: { name: "Outro Nome", document: CPF_1 } });
    check("a known document reuses the stored guest", sameDoc.status === 201 && sameDoc.json.guest.id === r1.guest.id && sameDoc.json.guest.name === "Hóspede Um", sameDoc);
    check("one occupant row per document", (await prisma.occupant.count({ where: { document: "52998224725" } })) === 1);
    const foreign = await carlos.session.call("POST", "/api/reservations", { propertyId: carlosFlat, checkIn: "2026-03-10", checkOut: "2026-03-12", occupant: undefined, occupantId: r1.guest.id });
    check("another organization's guest id is refused (400)", foreign.status === 400, foreign);
  });

  it("contract link", async () => {
    linked = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-10-01", checkOut: "2026-10-05", contractId: stayContract.id, occupant: undefined, occupantId: r1.guest.id });
    check("link an active short-stay contract that covers the stay -> 201", linked.status === 201 && linked.json.contractId === stayContract.id, linked);
    outside = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-12-30", checkOut: "2027-01-03", contractId: stayContract.id, occupant: undefined, occupantId: r1.guest.id });
    check("stay beyond the contract end -> 422", outside.status === 422, outside);
    before = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2025-12-30", checkOut: "2026-01-02", contractId: stayContract.id, occupant: undefined, occupantId: r1.guest.id });
    check("stay before the contract start -> 422", before.status === 422, before);
    lastDay = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-12-28", checkOut: "2026-12-31", contractId: stayContract.id, occupant: undefined, occupantId: r1.guest.id });
    check("check-out on the contract end date is covered", lastDay.status === 201, lastDay);
    const conventionalLink = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-11-01", checkOut: "2026-11-03", contractId: conventional.id, occupant: undefined, occupantId: r1.guest.id });
    check("contract of another property -> 400", conventionalLink.status === 400 && conventionalLink.json.error.details[0].path === "contractId", conventionalLink);
    const otherPropContract = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-11-01", checkOut: "2026-11-03", contractId: otherFlatContract.id, occupant: undefined, occupantId: r1.guest.id });
    check("short-stay contract of another property -> 400", otherPropContract.status === 400, otherPropContract);
    const unknownContract = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-11-01", checkOut: "2026-11-03", contractId: "00000000-0000-4000-8000-000000000000", occupant: undefined, occupantId: r1.guest.id });
    check("unknown contract -> 400", unknownContract.status === 400, unknownContract);
  });

  it("list / get", async () => {
    const list = await ana.session.call("GET", `/api/reservations?propertyId=${flat}&pageSize=100`);
    check("list by property, latest check-in first", list.status === 200 && list.json.items[0].checkIn >= list.json.items.at(-1).checkIn && list.json.items.every((i: any) => i.propertyId === flat), list.json?.items?.map((i: any) => i.checkIn));
    check("filter by status", (await ana.session.call("GET", "/api/reservations?status=cancelled")).json?.total === 0);
    check("filter by contract", (await ana.session.call("GET", `/api/reservations?contractId=${stayContract.id}`)).json?.total === 2);
    const window = await ana.session.call("GET", `/api/reservations?propertyId=${flat}&from=2026-03-14&to=2026-03-16`);
    check("calendar window returns the stays that overlap it", window.json?.total === 2 && window.json.items.map((i: any) => i.checkIn).sort().join() === "2026-03-10,2026-03-15", window.json?.items?.map((i: any) => [i.checkIn, i.checkOut]));
    const edge = await ana.session.call("GET", `/api/reservations?propertyId=${flat}&from=2026-03-18&to=2026-03-20`);
    check("a stay ending exactly at the window start is not in it", edge.json?.total === 0, edge.json?.items?.map((i: any) => [i.checkIn, i.checkOut]));
    const paged = await ana.session.call("GET", `/api/reservations?propertyId=${flat}&page=2&pageSize=3`);
    check("pagination", paged.json?.items?.length === 3 && paged.json.page === 2 && paged.json.total === list.json.total, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/reservations?pageSize=500")).status === 400);
    check("get by id", (await ana.session.call("GET", `/api/reservations/${r1.id}`)).json?.id === r1.id);
    check("unknown id -> 404", (await ana.session.call("GET", "/api/reservations/00000000-0000-4000-8000-000000000000")).status === 404);
  });

  it("patch", async () => {
    const patched = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { notes: "Chega tarde", totalAmountCents: 150_000 });
    check("patch notes and total", patched.status === 200 && patched.json.notes === "Chega tarde" && patched.json.totalAmountCents === 150_000 && patched.json.checkIn === "2026-03-10", patched);
    const extended = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { checkOut: "2026-03-14" });
    check("shortening a stay keeps it valid (self is not a clash)", extended.status === 200 && extended.json.nights === 4, extended);
    const intoClash = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { checkOut: "2026-03-16" });
    check("moving into another stay -> 409", intoClash.status === 409, intoClash);
    const badRange = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { checkIn: "2026-03-20" });
    check("merged range with check-out before check-in -> 400", badRange.status === 400, badRange);
    check("empty patch -> 400", (await ana.session.call("PATCH", `/api/reservations/${r1.id}`, {})).status === 400);
    link = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { contractId: stayContract.id });
    check("link a contract later", link.status === 200 && link.json.contractId === stayContract.id, link);
    const moveOut = await ana.session.call("PATCH", `/api/reservations/${linked.json.id}`, { checkIn: "2027-02-01", checkOut: "2027-02-04" });
    check("moving a linked stay outside the contract period -> 422", moveOut.status === 422, moveOut);
    const unlink = await ana.session.call("PATCH", `/api/reservations/${r1.id}`, { contractId: null });
    check("unlink the contract", unlink.status === 200 && unlink.json.contractId === null, unlink);
    const notesAfterContractEnded = await ana.session.call("PATCH", `/api/reservations/${lastDay.json.id}`, { notes: "ok" });
    check("editing notes does not re-check the contract", notesAfterContractEnded.status === 200, notesAfterContractEnded);
  });

  it("cancel", async () => {
    cancelled = await ana.session.call("POST", `/api/reservations/${turnoverAfter.json.id}/cancel`);
    check("cancel -> status cancelled", cancelled.status === 200 && cancelled.json.status === "cancelled", cancelled);
    check("cancelling twice -> 422", (await ana.session.call("POST", `/api/reservations/${turnoverAfter.json.id}/cancel`)).status === 422);
    check("cancelled reservations are read-only (422)", (await ana.session.call("PATCH", `/api/reservations/${turnoverAfter.json.id}`, { notes: "x" })).status === 422);
    const rebook = await ana.session.call("POST", "/api/reservations", { ...base, checkIn: "2026-03-15", checkOut: "2026-03-18", occupant: undefined, occupantId: r1.guest.id });
    check("cancelled dates are free again", rebook.status === 201, rebook);
    check("filter by status finds the cancelled one", (await ana.session.call("GET", "/api/reservations?status=cancelled")).json?.total === 1);
    check("reservations cannot be deleted", (await ana.session.call("DELETE", `/api/reservations/${r1.id}`)).status === 404);
    check("malformed id on cancel -> 400", (await ana.session.call("POST", "/api/reservations/xyz/cancel")).status === 400);
  });

  it("members and occupants", async () => {
    const biaRes = await bia.session.call("POST", "/api/reservations", { propertyId: biaFlat, checkIn: "2026-03-10", checkOut: "2026-03-12", occupant: { name: "Hóspede da Bia", document: "11.222.333/0001-81" } });
    check("member books her own property", biaRes.status === 201, biaRes);
    check("member cannot book another member's property (404)", (await bia.session.call("POST", "/api/reservations", { ...base, checkIn: "2027-05-01", checkOut: "2027-05-03" })).status === 404);
    const biaList = await bia.session.call("GET", "/api/reservations");
    check("member lists only reservations of her properties", biaList.json?.total === 1 && biaList.json.items[0].id === biaRes.json.id, biaList.json);
    check("member cannot read another member's reservation (404)", (await bia.session.call("GET", `/api/reservations/${r1.id}`)).status === 404);
    check("member cannot update or cancel it (404)",
      (await bia.session.call("PATCH", `/api/reservations/${r1.id}`, { notes: "x" })).status === 404 &&
      (await bia.session.call("POST", `/api/reservations/${r1.id}/cancel`)).status === 404);
    const biaGuests = await bia.session.call("GET", "/api/occupants");
    check("member sees the guests of her reservations", biaGuests.json?.total === 1 && biaGuests.json.items[0].name === "Hóspede da Bia", biaGuests.json);
    check("owner sees every reservation", (await ana.session.call("GET", "/api/reservations?pageSize=100")).json?.total === (await prisma.reservation.count({ where: { organizationId: ana.organizationId } })));
  });

  it("tenant isolation", async () => {
    check("other organization cannot read (404)", (await carlos.session.call("GET", `/api/reservations/${r1.id}`)).status === 404);
    check("other organization cannot update or cancel (404)",
      (await carlos.session.call("PATCH", `/api/reservations/${r1.id}`, { notes: "x" })).status === 404 &&
      (await carlos.session.call("POST", `/api/reservations/${r1.id}/cancel`)).status === 404);
    check("other organization lists nothing of ours", (await carlos.session.call("GET", "/api/reservations")).json?.total === 0);
    const sameDatesElsewhere = await carlos.session.call("POST", "/api/reservations", { propertyId: carlosFlat, checkIn: "2026-03-10", checkOut: "2026-03-15", occupant: { name: "Hóspede Um", document: CPF_1 } });
    check("same dates and document in another organization are independent", sameDatesElsewhere.status === 201 && sameDatesElsewhere.json.guest.id !== r1.guest.id, sameDatesElsewhere);
  });

  it("property deletion", async () => {
    check("deleting the property removes its reservations", (await ana.session.call("DELETE", `/api/properties/${flat2}`)).status === 204 && (await prisma.reservation.count({ where: { propertyId: flat2 } })) === 0);
  });
});
