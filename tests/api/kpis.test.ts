import { afterAll, beforeAll, describe, it } from "vitest";
import { computeIrr } from "../../src/modules/kpis/kpi-calculations.js";
import { near } from "../helpers/near.js";
import { check } from "../helpers/check.js";
import { Session, prisma, resetDatabase, signUp } from "../helpers/world.js";

const AS_OF = "2026-06-15";

/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("KPIs API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, clientA: any, p1: any, p2: any, p3: any, p4: any, p5: any, p6: any, biaProp: any, contract: any, kpis: any, a: any, c: any, portfolio: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("sets up the scenario", async () => {
    const anon = new Session();
    check("portfolio without session -> 401", (await anon.call("GET", "/api/kpis/portfolio")).status === 401);
    check("property KPIs without session -> 401", (await anon.call("GET", "/api/kpis/properties/00000000-0000-4000-8000-000000000000")).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });

    const mk = async (who: typeof ana, body: Record<string, unknown>) => {
      const r = await who.session.call("POST", "/api/properties", { propertyType: "residential", ...body });
      if (r.status !== 201) throw new Error(`property ${body.name}: ${JSON.stringify(r)}`);
      return r.json.id as string;
    };
    clientA = (await ana.session.call("POST", "/api/clients", { name: "Maria Oliveira" })).json.id as string;

    p1 = await mk(ana, {
      name: "P1 Manual", usageType: "rental", clientId: clientA, ownershipPercentage: 100, occupancyRate: 90,
      estimatedValueCents: 60_000_000, annualExpensesCents: 600_000,
      manualRental: { monthlyRentCents: 300_000, dueDay: 5 },
      acquisition: { acquisitionType: "purchase", acquiredOn: "2025-06-10", costCents: 50_000_000 },
    });
    p2 = await mk(ana, {
      name: "P2 Contract", usageType: "rental", rentalMode: "contract", ownershipPercentage: 50, occupancyRate: 100,
      estimatedValueCents: 80_000_000,
    });
    p3 = await mk(ana, {
      name: "P3 Short Stay", usageType: "short_stay", rentalMode: "contract", occupancyRate: 90,
      estimatedValueCents: 10_000_000, annualExpensesCents: 100_000,
    });
    p4 = await mk(ana, { name: "P4 Own Use", usageType: "own_use", estimatedValueCents: 30_000_000, annualExpensesCents: 50_000 });
    p5 = await mk(ana, { name: "P5 No Value", usageType: "rental", occupancyRate: 90, manualRental: { monthlyRentCents: 100_000 } });
    p6 = await mk(ana, { name: "P6 Vacant", usageType: "rental", estimatedValueCents: 20_000_000 });
    biaProp = await mk(bia, { name: "Imóvel da Bia", usageType: "rental", estimatedValueCents: 10_000_000, manualRental: { monthlyRentCents: 50_000 } });

    contract = await ana.session.call("POST", "/api/contracts", {
      propertyId: p2, contractType: "conventional", startDate: "2026-01-01",
      rentTerms: { monthlyRentCents: 500_000, dueDay: 10 }, occupant: { name: "Inquilino P2" },
    });
    await ana.session.call("POST", "/api/contracts", { propertyId: p3, contractType: "short_stay", startDate: "2025-01-01", occupant: { name: "Administradora" } });
    const book = (checkIn: string, checkOut: string, total: number) =>
      ana.session.call("POST", "/api/reservations", { propertyId: p3, checkIn, checkOut, totalAmountCents: total, occupant: { name: "Hóspede" } });
    await book("2025-08-01", "2025-08-05", 120_000);
    await book("2025-12-10", "2025-12-15", 180_000);
    await book("2025-06-10", "2025-06-14", 555_555); // before the window
    await book("2026-07-01", "2026-07-03", 999_999); // after the as-of date
    const cancelled = await book("2026-01-10", "2026-01-12", 777_777);
    await ana.session.call("POST", `/api/reservations/${cancelled.json.id}/cancel`);

    kpis = (id: string, who = ana, query = `asOf=${AS_OF}`) => who.session.call("GET", `/api/kpis/properties/${id}?${query}`);
  });

  it("manual rent", async () => {
    a = (await kpis(p1)).json;
    check("manual rent: source and monthly rent", a?.revenueSource === "manual" && a.monthlyRentCents === 300_000 && a.status === "rented", a);
    check("manual rent: revenue applies the occupancy rate", a?.annualRevenueCents === 3_240_000, a);
    check("manual rent: NOI = revenue - expenses", a?.noiCents === 2_640_000 && a.annualExpensesCents === 600_000, a);
    check("manual rent: gross yield and cap rate", near(a?.grossYield, 0.054) && near(a?.capRate, 0.044), a);
    const expectedIrr = computeIrr({ acquiredOn: "2025-06-10", costCents: 50_000_000, estimatedValueCents: 60_000_000, operatingMonthlyCents: 2_640_000 / 12, transactions: [], asOf: AS_OF });
    check("manual rent: IRR matches the calculation over the stored acquisition", a?.irr?.months === 12 && near(a.irr.annualRate, expectedIrr.annualRate!, 1e-9) && a.irr.unavailableReason === null, a?.irr);
    check("manual rent: IRR is plausible (20% appreciation + 5% net income)", a?.irr?.annualRate > 0.2 && a.irr.annualRate < 0.3, a?.irr);
  });

  it("transactions feed the IRR", async () => {
    const categories = (await ana.session.call("GET", "/api/lookups/transaction-categories")).json;
    const renovation = categories.find((c: any) => c.name === "Reforma").id;
    const sale = categories.find((c: any) => c.name === "Indenização").id;
    await ana.session.call("POST", "/api/transactions", { propertyId: p1, categoryId: renovation, amountCents: 1_000_000, occurredOn: "2025-12-01" });
    const afterExpense = (await kpis(p1)).json;
    check("an expense lowers the IRR", afterExpense?.irr?.annualRate < a.irr.annualRate, afterExpense?.irr);
    check("transactions do not change NOI, yield or cap rate", afterExpense?.noiCents === a.noiCents && near(afterExpense.capRate, a.capRate), afterExpense);
    await ana.session.call("POST", "/api/transactions", { propertyId: p1, categoryId: sale, amountCents: 3_000_000, occurredOn: "2026-02-10" });
    const afterRevenue = (await kpis(p1)).json;
    check("a revenue raises the IRR again", afterRevenue?.irr?.annualRate > afterExpense.irr.annualRate, afterRevenue?.irr);
    const withTxns = computeIrr({
      acquiredOn: "2025-06-10", costCents: 50_000_000, estimatedValueCents: 60_000_000, operatingMonthlyCents: 2_640_000 / 12, asOf: AS_OF,
      transactions: [
        { occurredOn: "2025-12-01", signedAmountCents: -1_000_000, isRecurring: false, recurrenceEndsOn: null },
        { occurredOn: "2026-02-10", signedAmountCents: 3_000_000, isRecurring: false, recurrenceEndsOn: null },
      ],
    });
    check("IRR with transactions matches the calculation", near(afterRevenue?.irr?.annualRate, withTxns.annualRate!, 1e-9), [afterRevenue?.irr, withTxns]);
  });

  it("iRR availability", async () => {
    check("no acquisition -> IRR unavailable (no date)", (await kpis(p5)).json?.irr?.unavailableReason === "no_acquisition_date");
    const early = (await kpis(p1, ana, "asOf=2025-06-30")).json;
    check("as-of in the acquisition month -> period too short", early?.irr?.unavailableReason === "period_too_short" && early.irr.annualRate === null, early?.irr);
    await ana.session.call("PATCH", `/api/properties/${p5}`, { acquisition: { acquisitionType: "inheritance", acquiredOn: "2020-01-01" } });
    check("inheritance without a base cost -> no cost", (await kpis(p5)).json?.irr?.unavailableReason === "no_acquisition_cost");
    await ana.session.call("PATCH", `/api/properties/${p1}`, { estimatedValueCents: null });
    const noValue = (await kpis(p1)).json;
    check("no estimated value: yields and IRR unavailable, NOI still there", noValue?.grossYield === null && noValue.capRate === null && noValue.irr.unavailableReason === "no_estimated_value" && noValue.noiCents === 2_640_000, noValue);
    await ana.session.call("PATCH", `/api/properties/${p1}`, { estimatedValueCents: 60_000_000 });
  });

  it("contract rent", async () => {
    const b = (await kpis(p2)).json;
    check("contract mode: rent comes from the active conventional contract", b?.revenueSource === "contract" && b.monthlyRentCents === 500_000 && b.status === "rented", b);
    check("contract mode: occupancy 100% -> revenue = rent x 12", b?.annualRevenueCents === 6_000_000 && b.noiCents === 6_000_000 && near(b.grossYield, 0.075) && near(b.capRate, 0.075), b);
    check("the share is exposed", b?.ownershipPercentage === 50);
  });

  it("short stay: realized revenue", async () => {
    c = (await kpis(p3)).json;
    check("short stay: revenue source is the bookings", c?.revenueSource === "reservations" && c.status === "rented", c);
    check("short stay: only confirmed bookings of the last 12 months count (300,000)", c?.annualRevenueCents === 300_000 && c.monthlyRentCents === 25_000, c);
    check("short stay: occupancy is not applied to realized revenue", c?.annualRevenueCents === 300_000, c);
    check("short stay: NOI, yield and cap rate", c?.noiCents === 200_000 && near(c.grossYield, 0.03) && near(c.capRate, 0.02), c);
    const earlier = (await kpis(p3, ana, "asOf=2025-12-31")).json;
    check("as-of moves the booking window", earlier?.annualRevenueCents === 855_555, earlier?.annualRevenueCents);
  });

  it("own use, no value, vacant", async () => {
    const d = (await kpis(p4)).json;
    check("own use: left out of the portfolio, no income, no yields, expenses remain", d?.includedInPortfolio === false && d.annualRevenueCents === 0 && d.noiCents === -50_000 && d.grossYield === null && d.capRate === null && d.status === "own_use", d);
    const e = (await kpis(p5)).json;
    check("rent without a value: NOI computed, yields null", e?.noiCents === 1_080_000 && e.grossYield === null && e.capRate === null, e);
    const f = (await kpis(p6)).json;
    check("vacant property: no revenue, zero yield", f?.revenueSource === "none" && f.annualRevenueCents === 0 && f.grossYield === 0 && f.capRate === 0 && f.status === "vacant", f);
  });

  it("ended contract", async () => {
    await ana.session.call("POST", `/api/contracts/${contract.json.id}/end`, {});
    const ended = (await kpis(p2)).json;
    check("after the contract ends the property has no revenue", ended?.revenueSource === "none" && ended.annualRevenueCents === 0 && ended.status === "vacant", ended);
    await ana.session.call("POST", "/api/contracts", { propertyId: p2, contractType: "conventional", startDate: "2026-02-01", rentTerms: { monthlyRentCents: 500_000, dueDay: 10 }, occupant: { name: "Inquilino P2" } });
  });

  it("portfolio", async () => {
    portfolio = (await ana.session.call("GET", `/api/kpis/portfolio?asOf=${AS_OF}`)).json;
    check("portfolio lists every property of the organization", portfolio?.propertyCount === 6 + 1 && portfolio.properties.length === 7, portfolio?.propertyCount);
    const t = portfolio?.totals;
    check("portfolio total value: all valued properties weighted by share", t?.totalValueCents === 60_000_000 + 40_000_000 + 10_000_000 + 30_000_000 + 20_000_000 + 10_000_000, t);
    check("income-producing value leaves out own use and value-less properties", t?.incomeProducingValueCents === 60_000_000 + 40_000_000 + 10_000_000 + 20_000_000 + 10_000_000, t);
    check("portfolio revenue, expenses and NOI (weighted, income-producing only)", t?.annualRevenueCents === 3_240_000 + 3_000_000 + 300_000 + 1_080_000 + 0 + 540_000 && t.annualExpensesCents === 600_000 + 100_000 && t.noiCents === (3_240_000 - 600_000) + 3_000_000 + 200_000 + 1_080_000 + 0 + 540_000, t);
    const valuedNoi = 2_640_000 + 3_000_000 + 200_000 + 0 + 540_000;
    const valuedRevenue = 3_240_000 + 3_000_000 + 300_000 + 0 + 540_000;
    check("portfolio cap rate and yield only use valued properties", near(t?.capRate, valuedNoi / t.incomeProducingValueCents) && near(t.grossYield, valuedRevenue / t.incomeProducingValueCents), t);
    check("counts by status", portfolio?.propertiesByStatus?.rented === 5 && portfolio.propertiesByStatus.own_use === 1 && portfolio.propertiesByStatus.vacant === 1 && portfolio.propertiesByStatus.loan_for_use === 0, portfolio?.propertiesByStatus);
    const clientView = (await ana.session.call("GET", `/api/kpis/portfolio?asOf=${AS_OF}&clientId=${clientA}`)).json;
    check("portfolio filtered by client", clientView?.propertyCount === 1 && clientView.properties[0].propertyId === p1 && clientView.totals.totalValueCents === 60_000_000, clientView);
  });

  it("validation, visibility, isolation", async () => {
    check("invalid as-of -> 400", (await ana.session.call("GET", "/api/kpis/portfolio?asOf=2026-13-01")).status === 400);
    check("invalid client filter -> 400", (await ana.session.call("GET", "/api/kpis/portfolio?clientId=x")).status === 400);
    check("non-uuid property id -> 400", (await ana.session.call("GET", "/api/kpis/properties/xyz")).status === 400);
    check("as-of defaults to today", (await ana.session.call("GET", "/api/kpis/portfolio")).json?.asOf === new Date().toISOString().slice(0, 10));
    check("unknown property -> 404", (await ana.session.call("GET", "/api/kpis/properties/00000000-0000-4000-8000-000000000000")).status === 404);
    const biaPortfolio = (await bia.session.call("GET", `/api/kpis/portfolio?asOf=${AS_OF}`)).json;
    check("member's portfolio only has her own properties", biaPortfolio?.propertyCount === 1 && biaPortfolio.properties[0].propertyId === biaProp && biaPortfolio.totals.totalValueCents === 10_000_000, biaPortfolio);
    check("member cannot read another member's property KPIs (404)", (await kpis(p1, bia)).status === 404);
    check("owner can read the member's property KPIs", (await kpis(biaProp)).status === 200);
    check("other organization cannot read the KPIs (404)", (await kpis(p1, carlos)).status === 404);
    const carlosPortfolio = (await carlos.session.call("GET", `/api/kpis/portfolio?asOf=${AS_OF}`)).json;
    check("empty portfolio: zeros and null rates", carlosPortfolio?.propertyCount === 0 && carlosPortfolio.totals.totalValueCents === 0 && carlosPortfolio.totals.capRate === null && carlosPortfolio.totals.grossYield === null, carlosPortfolio);
  });
  it("cash flow: validation", async () => {
    const get = (who: typeof ana, query: string) => who.session.call("GET", `/api/kpis/cash-flow?${query}`);
    const bad = async (name: string, query: string, path: string) => {
      const r = await get(ana, query);
      check(name, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR" && r.json.error.details.some((d: any) => d.path === path), r);
    };

    check("cash flow without session -> 401", (await new Session().call("GET", "/api/kpis/cash-flow?from=2026-01&to=2026-03")).status === 401);
    await bad("missing from -> 400 on from", "to=2026-03", "from");
    await bad("missing to -> 400 on to", "from=2026-01", "to");
    await bad("a day instead of a month -> 400 on from", "from=2026-01-01&to=2026-03", "from");
    await bad("month 13 -> 400 on from", "from=2026-13&to=2026-14", "from");
    await bad("month 00 -> 400 on to", "from=2026-01&to=2026-00", "to");
    await bad("a month without the leading zero -> 400", "from=2026-1&to=2026-3", "from");
    await bad("from after to -> 400 on to", "from=2026-05&to=2026-04", "to");
    await bad("37 months -> 400 on to", "from=2024-01&to=2027-01", "to");
    await bad("non-uuid propertyId -> 400 on propertyId", "from=2026-01&to=2026-03&propertyId=xyz", "propertyId");

    const longest = await get(ana, "from=2024-01&to=2026-12");
    check("36 months is the limit and is accepted", longest.status === 200 && longest.json?.months?.length === 36 && longest.json.months[0].month === "2024-01" && longest.json.months[35].month === "2026-12", longest.json?.months?.length);
    const single = await get(ana, "from=2026-05&to=2026-05");
    check("a single month is a valid window", single.status === 200 && single.json?.months?.length === 1 && single.json.from === "2026-05" && single.json.to === "2026-05", single);
  });

  it("cash flow: one property, with recurring transactions", async () => {
    const get = (who: typeof ana, query: string) => who.session.call("GET", `/api/kpis/cash-flow?${query}`);
    const categories = (await ana.session.call("GET", "/api/lookups/transaction-categories")).json;
    const financing = categories.find((c: any) => c.name === "Parcela de financiamento").id;
    const sale = categories.find((c: any) => c.name === "Indenização").id;
    // P1 already has a 1,000,000 expense on 2025-12-01 and a 3,000,000 revenue on 2026-02-10 (see the IRR test).
    await ana.session.call("POST", "/api/transactions", { propertyId: p1, categoryId: financing, amountCents: 40_000, occurredOn: "2025-11-05", isRecurring: true });
    await ana.session.call("POST", "/api/transactions", { propertyId: p1, categoryId: sale, amountCents: 5_000, occurredOn: "2026-01-15", isRecurring: true, recurrenceEndsOn: "2026-02-28" });

    const flow = (await get(ana, `from=2026-01&to=2026-03&propertyId=${p1}`)).json;
    const [jan, feb, mar] = flow?.months ?? [];
    check("the answer has the documented shape", flow && JSON.stringify(Object.keys(flow)) === '["from","to","months","totals"]' && JSON.stringify(Object.keys(jan)) === '["month","revenue","expenses","netCents"]' && JSON.stringify(Object.keys(jan.revenue)) === '["rentCents","reservationsCents","transactionsCents","totalCents"]' && JSON.stringify(Object.keys(jan.expenses)) === '["fixedCents","transactionsCents","totalCents"]', flow);
    check("one item per month, in order", flow?.months?.map((m: any) => m.month).join() === "2026-01,2026-02,2026-03");
    check("rent: the typed rent times the 90% occupancy, every month", [jan, feb, mar].every((m) => m?.revenue.rentCents === 270_000 && m.revenue.reservationsCents === 0), flow?.months);
    check("fixed expenses: the annual 600,000 divided by 12", [jan, feb, mar].every((m) => m?.expenses.fixedCents === 50_000));
    check("January: the recurring revenue that starts on the 15th and the open-ended recurring expense", jan?.revenue.transactionsCents === 5_000 && jan.expenses.transactionsCents === 40_000 && jan.revenue.totalCents === 275_000 && jan.expenses.totalCents === 90_000 && jan.netCents === 185_000, jan);
    check("February: the one-off revenue and the recurring one that ends in this month", feb?.revenue.transactionsCents === 3_005_000 && feb.expenses.transactionsCents === 40_000 && feb.netCents === 3_185_000, feb);
    check("March: the recurring revenue is over, the expense keeps going, the one-off is not repeated", mar?.revenue.transactionsCents === 0 && mar.expenses.transactionsCents === 40_000 && mar.netCents === 180_000, mar);
    check("totals", flow?.totals?.revenueCents === 3_820_000 && flow.totals.expensesCents === 270_000 && flow.totals.netCents === 3_550_000, flow?.totals);

    const december = (await get(ana, `from=2025-12&to=2025-12&propertyId=${p1}`)).json?.months?.[0];
    check("a recurring expense that started before the window and the one-off of that month", december?.expenses.transactionsCents === 1_040_000 && december.expenses.totalCents === 1_090_000 && december.revenue.totalCents === 270_000 && december.netCents === -820_000, december);
    const before = (await get(ana, `from=2025-10&to=2025-10&propertyId=${p1}`)).json?.months?.[0];
    check("before anything started, only rent and the fixed expenses", before?.expenses.transactionsCents === 0 && before.revenue.transactionsCents === 0 && before.netCents === 220_000, before);
  });

  it("cash flow: contract rent, bookings, ownership share and non-income properties", async () => {
    const get = (who: typeof ana, query: string) => who.session.call("GET", `/api/kpis/cash-flow?${query}`);

    const p2Flow = (await get(ana, `from=2026-01&to=2026-02&propertyId=${p2}`)).json;
    check("contract mode: the contract rent, the expected occupancy of 100%, the whole property despite the 50% share", p2Flow?.months?.every((m: any) => m.revenue.rentCents === 500_000 && m.expenses.totalCents === 0 && m.netCents === 500_000), p2Flow?.months);

    const stay = (await get(ana, `from=2025-12&to=2026-02&propertyId=${p3}`)).json;
    check("short stay: the confirmed bookings land in the month of the check-in, in full; the cancelled one does not count", stay?.months?.[0]?.revenue.reservationsCents === 180_000 && stay.months[1].revenue.reservationsCents === 0 && stay.months[2].revenue.reservationsCents === 0, stay?.months?.map((m: any) => m.revenue));
    check("short stay: no rent; fixed expenses are the annual 100,000 / 12 rounded", stay?.months?.every((m: any) => m.revenue.rentCents === 0 && m.expenses.fixedCents === 8_333) && stay.months[0].netCents === 171_667, stay?.months?.[0]);
    const july = (await get(ana, `from=2026-07&to=2026-07&propertyId=${p3}`)).json;
    check("a booking after the as-of date is still a cash flow of its own month", july?.months?.[0]?.revenue.reservationsCents === 999_999, july);
    const august = (await get(ana, `from=2025-08&to=2025-08&propertyId=${p3}`)).json;
    check("a booking from last year", august?.months?.[0]?.revenue.reservationsCents === 120_000, august);

    const own = (await get(ana, `from=2026-01&to=2026-01&propertyId=${p4}`)).json?.months?.[0];
    check("own use: no income, the fixed expenses remain", own?.revenue.totalCents === 0 && own.expenses.fixedCents === 4_167 && own.netCents === -4_167, own);
    const vacant = (await get(ana, `from=2026-01&to=2026-01&propertyId=${p6}`)).json?.months?.[0];
    check("vacant property: nothing", vacant?.revenue.totalCents === 0 && vacant.expenses.totalCents === 0 && vacant.netCents === 0, vacant);

    // Portfolio of January 2026, weighted by share: P1 (100%), P2 (50%), P3 (100%), P4, P5, P6 and Bia's property.
    const portfolio = (await get(ana, "from=2026-01&to=2026-03")).json;
    const jan = portfolio?.months?.[0];
    check("portfolio rent: P1 270,000 + P2 500,000 x 50% + P5 90,000 + Bia 45,000", jan?.revenue.rentCents === 270_000 + 250_000 + 90_000 + 45_000, jan);
    check("portfolio revenue transactions and bookings", jan?.revenue.transactionsCents === 5_000 && jan.revenue.reservationsCents === 0 && jan.revenue.totalCents === 660_000, jan);
    check("portfolio expenses: fixed P1 50,000 + P3 8,333 + P4 4,167 (own use counts), plus the financing transaction", jan?.expenses.fixedCents === 62_500 && jan.expenses.transactionsCents === 40_000 && jan.expenses.totalCents === 102_500 && jan.netCents === 557_500, jan);
    check("portfolio totals are the sum of the months", portfolio?.totals?.revenueCents === portfolio.months.reduce((t: number, m: any) => t + m.revenue.totalCents, 0) && portfolio.totals.expensesCents === portfolio.months.reduce((t: number, m: any) => t + m.expenses.totalCents, 0) && portfolio.totals.netCents === portfolio.totals.revenueCents - portfolio.totals.expensesCents, portfolio?.totals);
    check("the weighting is the same as the portfolio KPIs: the rent line of P2 is half of its own value", jan?.revenue.rentCents - (await get(ana, `from=2026-01&to=2026-01&propertyId=${p2}`)).json.months[0].revenue.rentCents / 2 === 270_000 + 90_000 + 45_000);
  });

  it("cash flow: visibility and isolation", async () => {
    const get = (who: typeof ana, query: string) => who.session.call("GET", `/api/kpis/cash-flow?${query}`);

    const mine = (await get(bia, "from=2026-01&to=2026-02")).json;
    check("a member only sees the properties she created", mine?.months?.length === 2 && mine.months[0].revenue.rentCents === 45_000 && mine.months[0].expenses.totalCents === 0 && mine.totals.netCents === 90_000, mine);
    check("a member asking for another member's property -> 404", (await get(bia, `from=2026-01&to=2026-02&propertyId=${p1}`)).status === 404);
    check("a member can ask for her own property", (await get(bia, `from=2026-01&to=2026-02&propertyId=${biaProp}`)).status === 200);
    check("the owner can ask for the member's property", (await get(ana, `from=2026-01&to=2026-02&propertyId=${biaProp}`)).status === 200);
    check("another organization's property -> 404", (await get(carlos, `from=2026-01&to=2026-02&propertyId=${p1}`)).status === 404);
    check("an unknown property -> 404", (await get(ana, "from=2026-01&to=2026-02&propertyId=00000000-0000-4000-8000-000000000000")).status === 404);

    const empty = (await get(carlos, "from=2026-01&to=2026-12")).json;
    check("an empty portfolio still answers every month, all zeros", empty?.months?.length === 12 && empty.months.every((m: any) => m.revenue.totalCents === 0 && m.expenses.totalCents === 0 && m.netCents === 0) && empty.totals.netCents === 0, empty?.totals);
  });

});
