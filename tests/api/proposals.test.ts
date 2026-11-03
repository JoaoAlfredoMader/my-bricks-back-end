import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type Account, Session, createCast, prisma, resetDatabase } from "../helpers/world.js";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Proposals and financing schedule API", () => {
  let ana: Account;
  let bia: Account;
  let carlos: Account;
  let apto: string;
  let biaProperty: string;
  let carlosProperty: string;
  let first: { id: string };

  const mk = async (who: Account, body: Record<string, unknown>) => {
    const r = await who.session.call("POST", "/api/properties", { propertyType: "residential", usageType: "rental", ...body });
    if (r.status !== 201) throw new Error(`property: ${JSON.stringify(r)}`);
    return r.json.id as string;
  };
  const proposals = (propertyId: string) => `/api/properties/${propertyId}/proposals`;

  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => prisma.$disconnect());

  it("requires a session", async () => {
    const anon = new Session();
    check("list without session -> 401", (await anon.call("GET", proposals("00000000-0000-4000-8000-000000000000"))).status === 401);
    check("schedule without session -> 401", (await anon.call("GET", "/api/properties/00000000-0000-4000-8000-000000000000/financing-schedule")).status === 401);
    ({ ana, bia, carlos } = await createCast());
    apto = await mk(ana, { name: "Apto 1" });
    biaProperty = await mk(bia, { name: "Imóvel da Bia" });
    carlosProperty = await mk(carlos, { name: "Imóvel do Carlos" });
  });

  it("creates proposals", async () => {
    const created = await ana.session.call("POST", proposals(apto), { proposalType: "purchase", amountCents: 70_000_000, proposalDate: "2026-03-10", contact: "  João Corretor ", notes: "" });
    check("create -> 201", created.status === 201, created);
    first = created.json;
    check("money in cents, date as YYYY-MM-DD, text trimmed, blank notes null",
      created.json?.amountCents === 70_000_000 && created.json.proposalDate === "2026-03-10" && created.json.contact === "João Corretor" && created.json.notes === null && created.json.propertyId === apto, created.json);
    check("a second proposal", (await ana.session.call("POST", proposals(apto), { proposalType: "sale", amountCents: 65_000_000, proposalDate: "2026-04-01" })).status === 201);
    check("a third proposal, older", (await ana.session.call("POST", proposals(apto), { proposalType: "rental", amountCents: 300_000, proposalDate: "2026-01-15" })).status === 201);

    const bad = (name: string, body: unknown, path?: string) =>
      ana.session.call("POST", proposals(apto), body).then((r) => {
        check(name, r.status === 400 && (!path || r.json?.error?.details?.some((d: { path: string }) => d.path === path)), r);
      });
    const ok = { proposalType: "purchase", amountCents: 1000, proposalDate: "2026-03-10" };
    await bad("zero amount -> 400", { ...ok, amountCents: 0 }, "amountCents");
    await bad("fractional amount -> 400", { ...ok, amountCents: 10.5 }, "amountCents");
    await bad("unknown type -> 400", { ...ok, proposalType: "barter" }, "proposalType");
    await bad("impossible date -> 400", { ...ok, proposalDate: "2026-02-30" }, "proposalDate");
    await bad("missing date -> 400", { proposalType: "sale", amountCents: 1000 }, "proposalDate");
    check("non-uuid property -> 400", (await ana.session.call("POST", proposals("xyz"), ok)).status === 400);
    check("unknown property -> 404", (await ana.session.call("POST", proposals("00000000-0000-4000-8000-000000000000"), ok)).status === 404);
    check("another organization's property -> 404", (await ana.session.call("POST", proposals(carlosProperty), ok)).status === 404);
  });

  it("lists, filters and paginates", async () => {
    const list = await ana.session.call("GET", proposals(apto));
    check("list: 3 proposals, latest date first", list.status === 200 && list.json.total === 3 && list.json.items.map((i: { proposalDate: string }) => i.proposalDate).join() === "2026-04-01,2026-03-10,2026-01-15", list.json?.items?.map((i: { proposalDate: string }) => i.proposalDate));
    check("filter by type", (await ana.session.call("GET", `${proposals(apto)}?proposalType=sale`)).json?.total === 1);
    const paged = await ana.session.call("GET", `${proposals(apto)}?page=2&pageSize=2`);
    check("pagination", paged.json?.items?.length === 1 && paged.json.total === 3 && paged.json.page === 2, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", `${proposals(apto)}?pageSize=500`)).status === 400);
    check("a property without proposals answers an empty page", (await bia.session.call("GET", proposals(biaProperty))).json?.total === 0);
    check("unknown property -> 404, not an empty page", (await ana.session.call("GET", proposals("00000000-0000-4000-8000-000000000000"))).status === 404);
    check("get one", (await ana.session.call("GET", `${proposals(apto)}/${first.id}`)).json?.id === first.id);
    check("a proposal under the wrong property -> 404", (await ana.session.call("GET", `${proposals(biaProperty)}/${first.id}`)).status === 404);
    check("unknown proposal -> 404", (await ana.session.call("GET", `${proposals(apto)}/00000000-0000-4000-8000-000000000000`)).status === 404);
  });

  it("edits and deletes proposals", async () => {
    const patched = await ana.session.call("PATCH", `${proposals(apto)}/${first.id}`, { amountCents: 72_500_000, notes: "Contraproposta", contact: null });
    check("patch changes only what was sent", patched.json?.amountCents === 72_500_000 && patched.json.notes === "Contraproposta" && patched.json.contact === null && patched.json.proposalType === "purchase", patched);
    check("empty patch -> 400", (await ana.session.call("PATCH", `${proposals(apto)}/${first.id}`, {})).status === 400);
    check("invalid value on patch -> 400", (await ana.session.call("PATCH", `${proposals(apto)}/${first.id}`, { amountCents: -5 })).status === 400);
    check("patch under the wrong property -> 404", (await ana.session.call("PATCH", `${proposals(biaProperty)}/${first.id}`, { notes: "x" })).status === 404);

    const deleted = await ana.session.call("DELETE", `${proposals(apto)}/${first.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("deleted proposal is gone (404)", (await ana.session.call("GET", `${proposals(apto)}/${first.id}`)).status === 404);
    check("delete twice -> 404", (await ana.session.call("DELETE", `${proposals(apto)}/${first.id}`)).status === 404);
  });

  it("keeps members and organizations apart", async () => {
    const biaProposal = await bia.session.call("POST", proposals(biaProperty), { proposalType: "sale", amountCents: 100, proposalDate: "2026-05-01" });
    check("a member records a proposal on her property", biaProposal.status === 201, biaProposal);
    check("a member cannot reach another member's property (404)",
      (await bia.session.call("GET", proposals(apto))).status === 404 &&
      (await bia.session.call("POST", proposals(apto), { proposalType: "sale", amountCents: 1, proposalDate: "2026-05-01" })).status === 404);
    const stillThere = (await ana.session.call("GET", proposals(apto))).json.items[0];
    check("a member cannot edit or delete another member's proposal (404)",
      (await bia.session.call("PATCH", `${proposals(apto)}/${stillThere.id}`, { notes: "x" })).status === 404 &&
      (await bia.session.call("DELETE", `${proposals(apto)}/${stillThere.id}`)).status === 404);
    check("the owner can reach the member's proposals", (await ana.session.call("GET", proposals(biaProperty))).json?.total === 1);
    check("another organization cannot read, edit or delete (404)",
      (await carlos.session.call("GET", `${proposals(apto)}/${stillThere.id}`)).status === 404 &&
      (await carlos.session.call("PATCH", `${proposals(apto)}/${stillThere.id}`, { notes: "x" })).status === 404 &&
      (await carlos.session.call("DELETE", `${proposals(apto)}/${stillThere.id}`)).status === 404 &&
      (await carlos.session.call("GET", proposals(apto))).status === 404);
    check("deleting the property removes its proposals", (await ana.session.call("DELETE", `/api/properties/${apto}`)).status === 204 && (await prisma.propertyProposal.count({ where: { propertyId: apto } })) === 0);
  });

  it("serves the financing schedule", async () => {
    const financed = await mk(ana, {
      name: "Financiado",
      acquisition: { acquisitionType: "purchase", acquiredOn: "2026-01-05", costCents: 12_000_000 },
      financing: { lender: "Caixa", financedAmountCents: 1_200_000, termMonths: 12, annualInterestRate: 12, amortizationSystem: "sac", firstInstallmentOn: "2026-02-10" },
    });
    const schedule = await ana.session.call("GET", `/api/properties/${financed}/financing-schedule?asOf=2026-05-10`);
    check("schedule -> 200 with the terms", schedule.status === 200 && schedule.json.amortizationSystem === "sac" && schedule.json.financedAmountCents === 1_200_000 && schedule.json.termMonths === 12 && schedule.json.annualInterestRate === 12, schedule);
    check("one installment per month, SAC amortizes 100,000 each", schedule.json?.installments?.length === 12 && schedule.json.installments[0].amortizationCents === 100_000 && schedule.json.installments[0].installmentCents === 112_000 && schedule.json.installments[0].dueOn === "2026-02-10", schedule.json?.installments?.[0]);
    check("the last installment settles the balance", schedule.json?.installments?.at(-1)?.balanceCents === 0 && schedule.json.installments.at(-1).dueOn === "2027-01-10");
    check("summary as of 2026-05-10: 4 paid, 8 remaining, balance after the 4th", schedule.json?.summary?.paidInstallments === 4 && schedule.json.summary.remainingInstallments === 8 && schedule.json.summary.outstandingBalanceCents === schedule.json.installments[3].balanceCents && schedule.json.summary.nextInstallment?.number === 5, schedule.json?.summary);
    const before = await ana.session.call("GET", `/api/properties/${financed}/financing-schedule?asOf=2026-01-01`);
    check("before the first due date everything is owed", before.json?.summary?.paidInstallments === 0 && before.json.summary.outstandingBalanceCents === 1_200_000, before.json?.summary);
    check("as-of defaults to today", (await ana.session.call("GET", `/api/properties/${financed}/financing-schedule`)).json?.asOf === new Date().toISOString().slice(0, 10));
    check("invalid as-of -> 400", (await ana.session.call("GET", `/api/properties/${financed}/financing-schedule?asOf=2026-13-01`)).status === 400);

    await ana.session.call("PATCH", `/api/properties/${financed}`, { financing: { lender: "Caixa", financedAmountCents: 1_200_000, termMonths: 12, annualInterestRate: 12, amortizationSystem: "price", firstInstallmentOn: "2026-02-10" } });
    const price = await ana.session.call("GET", `/api/properties/${financed}/financing-schedule?asOf=2026-05-10`);
    check("switching to Price changes the schedule", price.json?.amortizationSystem === "price" && Math.abs(price.json.installments[0].installmentCents - price.json.installments[5].installmentCents) <= 1, price.json?.installments?.slice(0, 2));

    check("a property without financing -> 404", (await ana.session.call("GET", `/api/properties/${await mk(ana, { name: "Sem financiamento" })}/financing-schedule`)).status === 404);
    check("unknown property -> 404", (await ana.session.call("GET", "/api/properties/00000000-0000-4000-8000-000000000000/financing-schedule")).status === 404);
    check("a member cannot read another member's schedule (404)", (await bia.session.call("GET", `/api/properties/${financed}/financing-schedule`)).status === 404);
    check("another organization cannot read the schedule (404)", (await carlos.session.call("GET", `/api/properties/${financed}/financing-schedule`)).status === 404);
  });
});
