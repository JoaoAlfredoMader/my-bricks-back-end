import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../../src/lib/storage/storage.js";
import type { ContractDocumentsRepository, ContractForDocument } from "../../src/modules/contract-documents/contract-documents.repository.js";
import { createContractDocumentsService } from "../../src/modules/contract-documents/contract-documents.service.js";
import type { TenantScope } from "../../src/shared/http/tenant.js";
import { extractPdfText, pdfContains } from "../helpers/pdf.js";

const tenant: TenantScope = { organizationId: "0c9a8f55-1d5e-4a4e-8d3f-6a8c4f0f2b77", userId: "user-1", canSeeAll: true };

const contract: ContractForDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  contractType: "conventional",
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  hasPdf: false,
  organizationName: "Portfólio de Ana",
  tenant: { name: "João <b>Inquilino</b>", document: "52998224725" },
  landlord: { name: "Maria Proprietária", document: "16899535009" },
  propertyName: "Apto 1",
  address: { street: "Rua Barão de Jaguara", number: "100", complement: "apto 12", neighborhood: "Centro", postalCode: "13015-904", city: "Campinas", state: "SP" },
  rentTerms: { monthlyRentCents: 350_000n, dueDay: 5, adjustmentIndex: "igpm" },
};

function setup(overrides: Partial<ContractForDocument> = {}, template: { header: string; clauses: string; footer: string } | null = null) {
  const written: { key: string; bytes: Buffer }[] = [];
  const repository = {
    load: vi.fn().mockResolvedValue({ ...contract, ...overrides }),
    replacePdf: vi.fn().mockResolvedValue({ previousStorageKey: null }),
    findPdf: vi.fn(),
  };
  const storage = {
    put: vi.fn(async (key: string, bytes: Buffer) => void written.push({ key, bytes })),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  } satisfies StorageProvider;
  const templates = { find: vi.fn().mockResolvedValue(template && { ...template, updatedById: null, updatedAt: new Date() }) };
  const service = createContractDocumentsService(repository as unknown as ContractDocumentsRepository, templates, storage, {
    today: () => "2026-11-03",
    compress: false,
  });
  return { repository, storage, templates, service, written, pdf: () => written[0]!.bytes };
}

describe("the generated contract", () => {
  it("fills the default template with the contract, the property and the people", async () => {
    const { service, pdf } = setup();
    await service.generate(tenant, contract.id);

    for (const expected of [
      "Maria Proprietária", "168.995.350-09", "João", "529.982.247-25",
      "Apto 1", "Rua Barão de Jaguara, 100, apto 12, Centro, Campinas/SP, CEP 13015-904",
      "R$ 3.500,00", "dia 5 de cada mês", "IGP-M", "01/01/2026", "31/12/2026", "3 de novembro de 2026",
      "LOCADOR(A)", "LOCATÁRIO(A)",
    ]) {
      expect(pdfContains(pdf(), expected), expected).toBe(true);
    }
    expect(extractPdfText(pdf())).not.toContain("{{");
  });

  it("escapes what the tenant typed: markup is shown as text, never interpreted", async () => {
    const { service, pdf } = setup();
    await service.generate(tenant, contract.id);
    expect(pdfContains(pdf(), "João <b>Inquilino</b>")).toBe(true);
  });

  it("uses the organization's own template instead of the default", async () => {
    const { service, pdf } = setup({}, { header: "<h1>MEU CONTRATO</h1>", clauses: "<p>Cláusula única: {{locatario}} paga {{valor_mensal}}.</p>", footer: "<p>Rodapé próprio</p>" });
    await service.generate(tenant, contract.id);

    expect(pdfContains(pdf(), "MEU CONTRATO")).toBe(true);
    expect(pdfContains(pdf(), "Cláusula única")).toBe(true);
    expect(pdfContains(pdf(), "Rodapé próprio")).toBe(true);
    expect(pdfContains(pdf(), "Cláusula 3ª")).toBe(false);
  });

  it("leaves a token it does not know as typed, so the typo shows", async () => {
    const { service, pdf } = setup({}, { header: "", clauses: "<p>Olá {{locatário}} e {{inquilino}}.</p>", footer: "" });
    await service.generate(tenant, contract.id);
    expect(pdfContains(pdf(), "{{locatário}}")).toBe(true);
    expect(pdfContains(pdf(), "{{inquilino}}")).toBe(true);
  });

  it("falls back to the organization as landlord when the property has no client", async () => {
    const { service, pdf } = setup({ landlord: null });
    await service.generate(tenant, contract.id);
    expect(pdfContains(pdf(), "Portfólio de Ana")).toBe(true);
    expect(pdfContains(pdf(), "CPF/CNPJ: não informado")).toBe(true);
  });

  it("says so when there is no end date, no address or no adjustment", async () => {
    const { service, pdf } = setup({
      endDate: null,
      address: null,
      rentTerms: { monthlyRentCents: 123_456n, dueDay: 31, adjustmentIndex: null },
    });
    await service.generate(tenant, contract.id);
    for (const expected of ["prazo indeterminado", "endereço não informado", "sem reajuste previsto", "R$ 1.234,56", "dia 31 de cada mês"]) {
      expect(pdfContains(pdf(), expected), expected).toBe(true);
    }
  });

  it("formats an alphanumeric CNPJ", async () => {
    const { service, pdf } = setup({ landlord: { name: "Construtora ABC", document: "12ABC34501DE35" } });
    await service.generate(tenant, contract.id);
    expect(pdfContains(pdf(), "12.ABC.345/01DE-35")).toBe(true);
  });
});

describe("storing the PDF", () => {
  it("stores under <organization>/<uuid>.pdf and records the file name", async () => {
    const { service, storage, repository, written } = setup();
    const dto = await service.generate(tenant, contract.id);

    expect(written[0]!.key).toMatch(/^0c9a8f55-1d5e-4a4e-8d3f-6a8c4f0f2b77\/[0-9a-f-]{36}\.pdf$/);
    expect(storage.put).toHaveBeenCalledWith(written[0]!.key, expect.any(Buffer), { contentType: "application/pdf" });
    expect(repository.replacePdf.mock.calls[0]![2]).toMatchObject({ storageKey: written[0]!.key, fileName: "contrato-apto-1-joao-b-inquilino-b.pdf", uploadedById: "user-1" });
    expect(dto).toMatchObject({ contractId: contract.id, fileName: "contrato-apto-1-joao-b-inquilino-b.pdf", url: `/api/contracts/${contract.id}/pdf` });
    expect(dto.sizeBytes).toBe(written[0]!.bytes.length);
  });

  it("deletes the previous object after the new one is recorded", async () => {
    const { service, storage, repository } = setup();
    repository.replacePdf.mockResolvedValue({ previousStorageKey: "org/old.pdf" });
    await service.generate(tenant, contract.id);
    expect(storage.delete).toHaveBeenCalledWith("org/old.pdf");
    expect(repository.replacePdf.mock.invocationCallOrder[0]).toBeLessThan(storage.delete.mock.invocationCallOrder[0]!);
  });

  it("still succeeds when the previous object cannot be deleted: the sweep takes it later", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { service, storage, repository } = setup();
    repository.replacePdf.mockResolvedValue({ previousStorageKey: "org/old.pdf" });
    storage.delete.mockRejectedValue(new Error("storage is down"));

    await expect(service.generate(tenant, contract.id)).resolves.toMatchObject({ contractId: contract.id });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("takes the new object back when the database refuses", async () => {
    const { service, storage, repository, written } = setup();
    repository.replacePdf.mockRejectedValue(new Error("database is down"));
    await expect(service.generate(tenant, contract.id)).rejects.toThrow("database is down");
    expect(storage.delete).toHaveBeenCalledWith(written[0]!.key);
  });

  it("writes nothing when the storage refuses", async () => {
    const { service, storage, repository } = setup();
    storage.put.mockRejectedValue(new Error("storage is down"));
    await expect(service.generate(tenant, contract.id)).rejects.toThrow("storage is down");
    expect(repository.replacePdf).not.toHaveBeenCalled();
  });
});

describe("what has no PDF", () => {
  it("a short-stay contract is a business rule error and renders nothing", async () => {
    const { service, storage } = setup({ contractType: "short_stay", rentTerms: null });
    await expect(service.generate(tenant, contract.id)).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION", status: 422 });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("an unknown contract is a 404", async () => {
    const { service, repository } = setup();
    repository.load.mockResolvedValue(null);
    await expect(service.generate(tenant, contract.id)).rejects.toMatchObject({ status: 404 });
  });

  it("downloading before generating is a 404 that says to generate it", async () => {
    const { service, repository } = setup();
    repository.findPdf.mockResolvedValue(null);
    await expect(service.download(tenant, contract.id)).rejects.toMatchObject({ status: 404, message: expect.stringContaining("Generate it first") });
  });
});
