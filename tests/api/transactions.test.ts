import { afterAll, beforeAll, describe, it } from "vitest";
import { check } from "../helpers/check.js";
import { type ApiResponse, Session, prisma, resetDatabase, signUp } from "../helpers/world.js";



/**
 * One scenario told in order: each test builds on the data of the previous ones,
 * so run the file as a whole rather than a single test.
 */
describe("Transactions API", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let ana: any, bia: any, carlos: any, apto: any, casa: any, biaProp: any, carlosProp: any, categories: any, revenue: any, expense: any, sale: any, renovation: any, financing: any, t1: any, open: any, ending: any, sameDayEnd: any, base: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("sets up the scenario", async () => {
    const anon = new Session();
    check("transactions without session -> 401", (await anon.call("GET", "/api/transactions")).status === 401);
    check("categories without session -> 401", (await anon.call("GET", "/api/lookups/transaction-categories")).status === 401);

    ana = await signUp("Ana Souza", "ana@example.com");
    bia = await signUp("Bia Lima", "bia@example.com");
    carlos = await signUp("Carlos Dias", "carlos@example.com");
    await prisma.member.create({ data: { organizationId: ana.organizationId, userId: bia.userId, role: "member" } });
    await bia.session.call("POST", "/api/auth/organization/set-active", { organizationId: ana.organizationId });

    const mkProperty = async (who: typeof ana, name: string) => {
      const r = await who.session.call("POST", "/api/properties", { name, propertyType: "residential", usageType: "rental" });
      if (r.status !== 201) throw new Error(`property ${name}: ${JSON.stringify(r)}`);
      return r.json.id as string;
    };
    apto = await mkProperty(ana, "Apto 1");
    casa = await mkProperty(ana, "Casa 2");
    biaProp = await mkProperty(bia, "Imóvel da Bia");
    carlosProp = await mkProperty(carlos, "Imóvel do Carlos");
  });

  it("categories", async () => {
    categories = await ana.session.call("GET", "/api/lookups/transaction-categories");
    check("categories: 12 seeded, revenue before expense", categories.status === 200 && categories.json.length === 12 && categories.json[0].transactionType === "revenue", categories.json?.length);
    revenue = categories.json.filter((c: any) => c.transactionType === "revenue");
    expense = categories.json.filter((c: any) => c.transactionType === "expense");
    sale = revenue.find((c: any) => c.name === "Venda de imóvel");
    renovation = expense.find((c: any) => c.name === "Reforma");
    financing = expense.find((c: any) => c.name === "Parcela de financiamento");
  });

  it("create", async () => {
    const one = await ana.session.call("POST", "/api/transactions", { propertyId: apto, categoryId: sale.id, amountCents: 50_000_000, occurredOn: "2026-05-10", description: "  Venda da vaga  " });
    check("create one-off revenue -> 201", one.status === 201, one);
    t1 = one.json;
    check("type derived from the category, amount positive cents", t1?.type === "revenue" && t1.categoryName === "Venda de imóvel" && t1.amountCents === 50_000_000, t1);
    check("dates as YYYY-MM-DD, not recurring by default, description trimmed", t1?.occurredOn === "2026-05-10" && t1.isRecurring === false && t1.recurrenceEndsOn === null && t1.description === "Venda da vaga" && t1.propertyName === "Apto 1", t1);
    open = await ana.session.call("POST", "/api/transactions", { propertyId: apto, categoryId: financing.id, amountCents: 250_000, occurredOn: "2026-01-05", isRecurring: true, description: "" });
    check("create open-ended recurring expense -> 201", open.status === 201 && open.json.type === "expense" && open.json.isRecurring && open.json.recurrenceEndsOn === null && open.json.description === null, open);
    ending = await ana.session.call("POST", "/api/transactions", { propertyId: casa, categoryId: renovation.id, amountCents: 80_000, occurredOn: "2026-02-01", isRecurring: true, recurrenceEndsOn: "2026-06-01" });
    check("recurring with an end date -> 201", ending.status === 201 && ending.json.recurrenceEndsOn === "2026-06-01", ending);
    sameDayEnd = await ana.session.call("POST", "/api/transactions", { propertyId: casa, categoryId: renovation.id, amountCents: 1, occurredOn: "2026-02-01", isRecurring: true, recurrenceEndsOn: "2026-02-01" });
    check("end date equal to the first occurrence is allowed", sameDayEnd.status === 201, sameDayEnd);
  });

  it("validation", async () => {
    base = { propertyId: apto, categoryId: sale.id, amountCents: 1000, occurredOn: "2026-05-10" };
    const bad = (name: string, body: unknown, path?: string) =>
      ana.session.call("POST", "/api/transactions", body).then((r: ApiResponse) => {
        check(name, r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR" && (!path || r.json.error.details.some((d: any) => d.path === path)), r);
      });
    await bad("zero amount -> 400", { ...base, amountCents: 0 }, "amountCents");
    await bad("negative amount -> 400", { ...base, amountCents: -5 }, "amountCents");
    await bad("fractional amount -> 400", { ...base, amountCents: 10.5 }, "amountCents");
    await bad("end date on a non-recurring transaction -> 400", { ...base, recurrenceEndsOn: "2026-12-01" }, "recurrenceEndsOn");
    await bad("end date before the first occurrence -> 400", { ...base, isRecurring: true, recurrenceEndsOn: "2026-05-09" }, "recurrenceEndsOn");
    await bad("impossible date -> 400", { ...base, occurredOn: "2026-02-30" }, "occurredOn");
    await bad("non-uuid property -> 400", { ...base, propertyId: "x" }, "propertyId");
    await bad("unknown category -> 400", { ...base, categoryId: 99999 }, "categoryId");
    await bad("description above 500 characters -> 400", { ...base, description: "x".repeat(501) }, "description");
    check("failed creates left nothing behind", (await prisma.transaction.count()) === 4);
    check("unknown property -> 404", (await ana.session.call("POST", "/api/transactions", { ...base, propertyId: "00000000-0000-4000-8000-000000000000" })).status === 404);
    check("another organization's property -> 404", (await ana.session.call("POST", "/api/transactions", { ...base, propertyId: carlosProp })).status === 404);
  });

  it("list", async () => {
    const list = await ana.session.call("GET", "/api/transactions");
    check("list: 4 transactions, latest first", list.status === 200 && list.json.total === 4 && list.json.items[0].occurredOn === "2026-05-10" && list.json.items.at(-1).occurredOn === "2026-01-05", list.json?.items?.map((i: any) => i.occurredOn));
    check("filter by property", (await ana.session.call("GET", `/api/transactions?propertyId=${casa}`)).json?.total === 2);
    check("filter by category", (await ana.session.call("GET", `/api/transactions?categoryId=${sale.id}`)).json?.total === 1);
    check("filter by type=revenue", (await ana.session.call("GET", "/api/transactions?type=revenue")).json?.total === 1);
    check("filter by type=expense", (await ana.session.call("GET", "/api/transactions?type=expense")).json?.total === 3);
    check("filter recurring", (await ana.session.call("GET", "/api/transactions?isRecurring=true")).json?.total === 3);
    check("filter not recurring", (await ana.session.call("GET", "/api/transactions?isRecurring=false")).json?.total === 1);
    check("date bounds are inclusive (the open-ended recurrence from January is still running)", (await ana.session.call("GET", "/api/transactions?from=2026-02-01&to=2026-05-10")).json?.total === 4);
    check("date window after everything: only the open-ended recurrence remains", (await ana.session.call("GET", "/api/transactions?from=2027-01-01")).json?.total === 1);
    const paged = await ana.session.call("GET", "/api/transactions?page=2&pageSize=3");
    check("pagination", paged.json?.items?.length === 1 && paged.json.total === 4 && paged.json.page === 2, paged.json);
    check("pageSize above the cap -> 400", (await ana.session.call("GET", "/api/transactions?pageSize=500")).status === 400);
    check("invalid type filter -> 400", (await ana.session.call("GET", "/api/transactions?type=gift")).status === 400);
    check("get by id", (await ana.session.call("GET", `/api/transactions/${t1.id}`)).json?.id === t1.id);
    check("unknown id -> 404", (await ana.session.call("GET", "/api/transactions/00000000-0000-4000-8000-000000000000")).status === 404);
  });

  it("period filter keeps the recurring transactions whose occurrences touch the period", async () => {
    // Data: t1 one-off 2026-05-10 | open recurring from 2026-01-05, no end | ending recurring 2026-02-01..2026-06-01 | sameDayEnd recurring 2026-02-01..2026-02-01
    const ids = async (query: string) => {
      const r = await ana.session.call("GET", `/api/transactions?${query}`);
      return { total: r.json?.total as number, ids: (r.json?.items ?? []).map((i: any) => i.id) as string[] };
    };
    const sameDay = sameDayEnd.json.id as string;

    const secondHalf = await ids("from=2026-07-01&to=2026-12-31");
    check("recurring that started before the window and has no end appears; the ones that ended before it, and the one-off, do not", secondHalf.total === 1 && secondHalf.ids[0] === open.json.id, secondHalf);

    const endsInside = await ids("from=2026-03-01&to=2026-03-31");
    check("recurring that ends after the window starts appears; the one that ended in February does not", endsInside.total === 2 && endsInside.ids.includes(ending.json.id) && endsInside.ids.includes(open.json.id) && !endsInside.ids.includes(sameDay), endsInside);

    const endMonth = await ids("from=2026-06-20&to=2026-06-30");
    check("the end counts by month, inclusive: ending 2026-06-01 still reaches a window starting on 2026-06-20", endMonth.ids.includes(ending.json.id) && endMonth.total === 2, endMonth);
    const afterEndMonth = await ids("from=2026-07-01&to=2026-07-31");
    check("...and no longer reaches July", !afterEndMonth.ids.includes(ending.json.id), afterEndMonth);

    const monthOfEnd = await ids("from=2026-02-15&to=2026-02-28");
    check("a window inside the only month of a one-month recurrence still finds it", monthOfEnd.ids.includes(sameDay), monthOfEnd);

    const beforeStart = await ids("to=2026-01-31");
    check("only `to`: recurring that starts after it is out, the one running by then is in", beforeStart.total === 1 && beforeStart.ids[0] === open.json.id, beforeStart);
    check("window before everything is empty", (await ids("from=2025-01-01&to=2025-12-31")).total === 0);

    const oneOffs = await ids("from=2026-05-11&to=2026-05-31");
    check("one-off transactions keep the plain date rule: the 2026-05-10 sale is out of a window starting on the 11th", !oneOffs.ids.includes(t1.id), oneOffs);
    const year = await ana.session.call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31");
    check("a whole year: all 4, still latest first", year.json?.total === 4 && year.json.items.map((i: any) => i.occurredOn).join() === "2026-05-10,2026-02-01,2026-02-01,2026-01-05", year.json?.items?.map((i: any) => i.occurredOn));
    const oneOffOnly = await ids("from=2026-01-01&to=2026-12-31&isRecurring=false");
    check("combines with the other filters", oneOffOnly.total === 1 && oneOffOnly.ids[0] === t1.id, oneOffOnly);
    const revenueOnly = await ids("from=2026-07-01&to=2026-12-31&type=revenue");
    check("combines with the type filter", revenueOnly.total === 0, revenueOnly);
    const paged = await ana.session.call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31&page=2&pageSize=3");
    check("pagination counts the matching recurring too", paged.json?.total === 4 && paged.json.items.length === 1, paged.json);

    const old = await ana.session.call("POST", "/api/transactions", { propertyId: apto, categoryId: financing.id, amountCents: 100, occurredOn: "2021-03-10", isRecurring: true });
    const thisYear = await ids("from=2026-01-01&to=2026-12-31");
    check("a monthly charge that started in 2021 and never ended shows up in this year", thisYear.ids.includes(old.json.id) && thisYear.total === 5, thisYear);
    await ana.session.call("DELETE", `/api/transactions/${old.json.id}`);
  });

  it("patch", async () => {
    const patched = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { amountCents: 52_000_000, description: null });
    check("patch amount and clear the description", patched.status === 200 && patched.json.amountCents === 52_000_000 && patched.json.description === null && patched.json.occurredOn === "2026-05-10", patched);
    const flipped = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { categoryId: renovation.id });
    check("changing the category flips the derived type", flipped.json?.type === "expense" && flipped.json.categoryName === "Reforma", flipped);
    check("unknown category on patch -> 400", (await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { categoryId: 99999 })).status === 400);
    check("empty patch -> 400", (await ana.session.call("PATCH", `/api/transactions/${t1.id}`, {})).status === 400);
    const endOnOneOff = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { recurrenceEndsOn: "2026-12-01" });
    check("end date on a non-recurring transaction -> 400", endOnOneOff.status === 400, endOnOneOff);
    const makeRecurring = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { isRecurring: true, recurrenceEndsOn: "2026-12-01" });
    check("make it recurring with an end date", makeRecurring.status === 200 && makeRecurring.json.isRecurring && makeRecurring.json.recurrenceEndsOn === "2026-12-01", makeRecurring);
    const movedPastEnd = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { occurredOn: "2027-01-01" });
    check("moving the first occurrence past the stored end date -> 400", movedPastEnd.status === 400, movedPastEnd);
    const clearedEnd = await ana.session.call("PATCH", `/api/transactions/${t1.id}`, { recurrenceEndsOn: null });
    check("end date can be cleared (open-ended)", clearedEnd.status === 200 && clearedEnd.json.recurrenceEndsOn === null && clearedEnd.json.isRecurring, clearedEnd);
    const withEnd = await ana.session.call("PATCH", `/api/transactions/${ending.json.id}`, { isRecurring: false });
    check("turning recurrence off drops the end date on its own", withEnd.status === 200 && withEnd.json.isRecurring === false && withEnd.json.recurrenceEndsOn === null, withEnd);
    const offAndEnd = await ana.session.call("PATCH", `/api/transactions/${ending.json.id}`, { isRecurring: false, recurrenceEndsOn: "2026-09-01" });
    check("turning recurrence off while sending an end date -> 400", offAndEnd.status === 400, offAndEnd);
    const moved = await ana.session.call("PATCH", `/api/transactions/${open.json.id}`, { occurredOn: "2026-03-05" });
    check("moving the date of an open-ended recurrence", moved.status === 200 && moved.json.occurredOn === "2026-03-05", moved);
  });

  it("delete", async () => {
    const deleted = await ana.session.call("DELETE", `/api/transactions/${sameDayEnd.json.id}`);
    check("delete -> 204", deleted.status === 204, deleted);
    check("deleted transaction is gone (404)", (await ana.session.call("GET", `/api/transactions/${sameDayEnd.json.id}`)).status === 404);
    check("delete twice -> 404", (await ana.session.call("DELETE", `/api/transactions/${sameDayEnd.json.id}`)).status === 404);
  });

  it("members", async () => {
    const biaTx = await bia.session.call("POST", "/api/transactions", { propertyId: biaProp, categoryId: sale.id, amountCents: 100, occurredOn: "2026-05-10" });
    check("member records a transaction on her property", biaTx.status === 201, biaTx);
    check("member cannot record on another member's property (404)", (await bia.session.call("POST", "/api/transactions", { ...base })).status === 404);
    const biaList = await bia.session.call("GET", "/api/transactions");
    check("member lists only transactions of her properties", biaList.json?.total === 1 && biaList.json.items[0].id === biaTx.json.id, biaList.json);
    check("member cannot read another member's transaction (404)", (await bia.session.call("GET", `/api/transactions/${t1.id}`)).status === 404);
    check("member cannot update or delete it (404)",
      (await bia.session.call("PATCH", `/api/transactions/${t1.id}`, { amountCents: 1 })).status === 404 &&
      (await bia.session.call("DELETE", `/api/transactions/${t1.id}`)).status === 404);
    check("member can use the shared categories", (await bia.session.call("GET", "/api/lookups/transaction-categories")).json?.length === 12);
    check("owner sees everything in the organization", (await ana.session.call("GET", "/api/transactions")).json?.total === 4);
    check("owner can edit the member's transaction", (await ana.session.call("PATCH", `/api/transactions/${biaTx.json.id}`, { amountCents: 200 })).json?.amountCents === 200);
  });

  it("tenant isolation", async () => {
    check("other organization cannot read (404)", (await carlos.session.call("GET", `/api/transactions/${t1.id}`)).status === 404);
    check("other organization cannot update or delete (404)",
      (await carlos.session.call("PATCH", `/api/transactions/${t1.id}`, { amountCents: 1 })).status === 404 &&
      (await carlos.session.call("DELETE", `/api/transactions/${t1.id}`)).status === 404);
    check("other organization lists nothing of ours", (await carlos.session.call("GET", "/api/transactions")).json?.total === 0);
    check("transaction untouched after cross-tenant attempts", (await prisma.transaction.findUnique({ where: { id: t1.id } }))?.amountCents === 52_000_000n);
  });

  it("property deletion", async () => {
    check("deleting the property removes its transactions", (await ana.session.call("DELETE", `/api/properties/${casa}`)).status === 204 && (await prisma.transaction.count({ where: { propertyId: casa } })) === 0);
  });
});
