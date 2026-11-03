import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { propertySubtypes, propertyTypeUsages, transactionCategories } from "../../prisma/seed/data/catalog.js";
import { buildDemoPlan, fakeCnpj, fakeCpf } from "../../src/modules/demo/demo-data.js";
import { isValidCnpj, isValidCpf } from "../../src/shared/validation/brazilian-document.js";
import { derivePropertyStatus } from "../../src/modules/properties/property-status.js";

const cities = new Set(
  (JSON.parse(readFileSync("prisma/seed/data/cities.json", "utf8")) as [number, string, string][]).map(([, name, state]) => `${name}/${state}`),
);
const TODAY = new Date("2026-11-03T00:00:00Z");
const plan = buildDemoPlan(TODAY);
const day = (date: Date) => date.toISOString().slice(0, 10);
const daysFromToday = (date: Date) => Math.round((date.getTime() - TODAY.getTime()) / 86_400_000);

describe("fake documents", () => {
  it("fakeCpf produces CPFs that pass the real validator", () => {
    for (const base of ["529982247", "168995350", "111444777", "123456789", "000000001", "987654321"]) {
      expect(isValidCpf(fakeCpf(base)), base).toBe(true);
    }
  });

  it("fakeCnpj produces CNPJs that pass the real validator", () => {
    for (const base of ["112223330001", "445556660001", "778889990001", "123456780001"]) {
      expect(isValidCnpj(fakeCnpj(base)), base).toBe(true);
    }
  });
});

describe("the sample portfolio", () => {
  it("has a meaningful size", () => {
    expect(plan.properties).toHaveLength(9);
    expect(plan.clients.length).toBeGreaterThanOrEqual(3);
    expect(plan.contracts.length).toBeGreaterThanOrEqual(4);
    expect(plan.reservations.length).toBeGreaterThanOrEqual(6);
    expect(plan.transactions.length).toBeGreaterThanOrEqual(5);
    expect(plan.proposals.length).toBeGreaterThanOrEqual(3);
  });

  it("every document is valid and unique", () => {
    const documents = [...plan.clients, ...plan.occupants].map((person) => person.document).filter((value): value is string => value !== null);
    for (const document of documents) expect(isValidCpf(document) || isValidCnpj(document), document).toBe(true);
    expect(new Set(documents).size).toBe(documents.length);
  });

  it("clients have the person type their document implies", () => {
    for (const client of plan.clients) {
      expect(client.personType === "individual" ? isValidCpf(client.document) : isValidCnpj(client.document), client.name).toBe(true);
    }
  });

  it("keys are unique and every reference points to something that exists", () => {
    const unique = (keys: string[]) => expect(new Set(keys).size).toBe(keys.length);
    unique(plan.properties.map((p) => p.key));
    unique(plan.clients.map((c) => c.key));
    unique(plan.occupants.map((o) => o.key));
    unique(plan.contracts.map((c) => c.key));

    const properties = new Set(plan.properties.map((p) => p.key));
    const occupants = new Set(plan.occupants.map((o) => o.key));
    const clients = new Set(plan.clients.map((c) => c.key));
    const agencies = new Set(plan.agencies.map((a) => a.key));
    const contracts = new Set(plan.contracts.map((c) => c.key));
    for (const property of plan.properties) {
      if (property.clientKey) expect(clients.has(property.clientKey), property.name).toBe(true);
      if (property.agencyKey) expect(agencies.has(property.agencyKey), property.name).toBe(true);
    }
    for (const contract of plan.contracts) {
      expect(properties.has(contract.propertyKey) && occupants.has(contract.occupantKey)).toBe(true);
    }
    for (const reservation of plan.reservations) {
      expect(properties.has(reservation.propertyKey) && occupants.has(reservation.occupantKey) && contracts.has(reservation.contractKey)).toBe(true);
    }
    for (const row of [...plan.transactions, ...plan.proposals]) expect(properties.has(row.propertyKey)).toBe(true);
  });

  it("respects the reference data: subtypes, allowed usages, cities and categories exist", () => {
    for (const property of plan.properties) {
      expect(propertySubtypes.some((s) => s.propertyType === property.propertyType && s.name === property.subtype), `${property.name} subtype`).toBe(true);
      expect(propertyTypeUsages.some((u) => u.propertyType === property.propertyType && u.usageType === property.usageType), `${property.name} usage`).toBe(true);
      expect(cities.has(`${property.address.city}/${property.address.state}`), `${property.name} city`).toBe(true);
    }
    for (const transaction of plan.transactions) {
      expect(transactionCategories.some((c) => c.transactionType === transaction.category.type && c.name === transaction.category.name), transaction.category.name).toBe(true);
    }
  });

  it("follows the property rules of the API", () => {
    for (const property of plan.properties) {
      if (property.parkingSpotLabel) expect(property.propertyType).toBe("parking");
      if (property.manualRental) expect(property.rentalMode).toBe("manual");
      if (property.financing) expect(["purchase", "construction"]).toContain(property.acquisition?.acquisitionType);
      if (property.legalRecord?.irregularityDescription) expect(property.legalRecord.registrationStatus).toBe("irregular");
      expect(property.ownershipPercentage > 0 && property.ownershipPercentage <= 100).toBe(true);
      expect(property.occupancyRate >= 0 && property.occupancyRate <= 100).toBe(true);
    }
  });

  it("contracts are consistent: ordered dates, one active per property, rent terms only on conventional ones", () => {
    for (const contract of plan.contracts) {
      if (contract.endDate) expect(contract.endDate.getTime()).toBeGreaterThan(contract.startDate.getTime());
      expect(Boolean(contract.rentTerms)).toBe(contract.contractType === "conventional");
      if (contract.rentTerms) expect(contract.rentTerms.monthlyRentCents > 0 && contract.rentTerms.dueDay >= 1 && contract.rentTerms.dueDay <= 31).toBe(true);
    }
    const active = plan.contracts.filter((c) => c.status === "active").map((c) => c.propertyKey);
    expect(new Set(active).size).toBe(active.length);
  });

  it("contracts only sit on properties in contract mode with a compatible usage", () => {
    for (const contract of plan.contracts) {
      const property = plan.properties.find((p) => p.key === contract.propertyKey)!;
      expect(property.rentalMode, property.name).toBe("contract");
      expect(contract.contractType === "short_stay", property.name).toBe(property.usageType === "short_stay");
    }
  });

  it("confirmed reservations never overlap and sit inside their contract", () => {
    const confirmed = plan.reservations.filter((r) => r.status === "confirmed").sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
    for (const reservation of plan.reservations) expect(reservation.checkOut.getTime()).toBeGreaterThan(reservation.checkIn.getTime());
    for (let i = 1; i < confirmed.length; i++) expect(confirmed[i]!.checkIn.getTime()).toBeGreaterThanOrEqual(confirmed[i - 1]!.checkOut.getTime());
    for (const reservation of plan.reservations) {
      const contract = plan.contracts.find((c) => c.key === reservation.contractKey)!;
      expect(reservation.checkIn.getTime()).toBeGreaterThanOrEqual(contract.startDate.getTime());
      expect(contract.contractType).toBe("short_stay");
    }
  });

  it("is built around today: something ends soon, something is coming, something just happened", () => {
    const active = plan.contracts.filter((c) => c.status === "active" && c.endDate);
    expect(active.some((c) => daysFromToday(c.endDate!) > 0 && daysFromToday(c.endDate!) <= 90)).toBe(true);
    expect(plan.reservations.some((r) => r.status === "confirmed" && daysFromToday(r.checkIn) > 0)).toBe(true);
    expect(plan.reservations.some((r) => r.status === "cancelled")).toBe(true);
    expect(plan.transactions.some((t) => daysFromToday(t.occurredOn) > -30)).toBe(true);
    expect(plan.proposals.every((p) => daysFromToday(p.proposalDate) <= 0)).toBe(true);
  });

  it("shows every status: rented, vacant, own use", () => {
    const statuses = new Set(
      plan.properties.map((property) =>
        derivePropertyStatus({
          usageType: property.usageType,
          rentalMode: property.rentalMode,
          manualRental: property.manualRental ? { tenantName: property.manualRental.tenantName, monthlyRentCents: BigInt(property.manualRental.monthlyRentCents) } : null,
          hasActiveContract: plan.contracts.some((c) => c.propertyKey === property.key && c.status === "active"),
        }),
      ),
    );
    expect(statuses).toEqual(new Set(["rented", "vacant", "own_use"]));
  });

  it("covers the variety of the product: every property type, a shared ownership, financing, an irregular registry", () => {
    expect(new Set(plan.properties.map((p) => p.propertyType))).toEqual(new Set(["residential", "commercial", "land", "logistics", "parking"]));
    expect(plan.properties.some((p) => p.ownershipPercentage < 100)).toBe(true);
    expect(plan.properties.some((p) => p.financing)).toBe(true);
    expect(plan.properties.some((p) => p.legalRecord?.registrationStatus === "irregular")).toBe(true);
    expect(plan.properties.some((p) => p.acquisition?.acquisitionType === "inheritance")).toBe(true);
    expect(plan.transactions.some((t) => t.isRecurring)).toBe(true);
  });

  it("is deterministic for the same day and moves with the day", () => {
    expect(buildDemoPlan(TODAY)).toEqual(plan);
    const later = buildDemoPlan(new Date("2027-03-01T00:00:00Z"));
    expect(day(later.contracts.find((c) => c.key === "centro")!.endDate!)).not.toBe(day(plan.contracts.find((c) => c.key === "centro")!.endDate!));
    expect(daysFromToday(later.contracts.find((c) => c.key === "centro")!.endDate!) + 0).toBeGreaterThan(0);
  });
});
