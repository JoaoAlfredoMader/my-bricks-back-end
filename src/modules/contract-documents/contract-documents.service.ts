import type { StorageProvider } from "../../lib/storage/storage.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { centsToNumber } from "../../shared/money.js";
import { storageKeyFor } from "../files/file-upload.js";
import type { ContractTemplatesRepository } from "../contract-templates/contract-templates.repository.js";
import { DEFAULT_TEMPLATE } from "../contract-templates/default-template.js";
import { type PlaceholderValues, fillPlaceholders } from "../contract-templates/placeholders.js";
import { renderContractPdf } from "./contract-pdf.js";
import type { ContractDocumentsRepository, ContractForDocument, DocumentScope } from "./contract-documents.repository.js";
import { adjustmentLabel, formatAddress, formatDate, formatDocument, formatLongDate, formatMoney } from "./formatting.js";
import { parseBlocks } from "./html-blocks.js";

export interface ContractPdfDto {
  contractId: string;
  fileName: string;
  sizeBytes: number;
  generatedAt: string;
  /** Path of the endpoint that serves the PDF. */
  url: string;
}

export interface ContractPdfFile {
  bytes: Buffer;
  fileName: string;
}

export interface ContractDocumentsService {
  /** Renders the contract with the organization's template and stores it as the contract's PDF. */
  generate(tenant: TenantScope, contractId: string): Promise<ContractPdfDto>;
  download(tenant: TenantScope, contractId: string): Promise<ContractPdfFile>;
}

export interface ContractDocumentsOptions {
  /** Today as `YYYY-MM-DD`; injectable so the issue date in the document is predictable. */
  today?: () => string;
  /** Turn off the PDF stream compression, so tests can read the text. */
  compress?: boolean;
}

/** Owners and admins see the whole organization; members only contracts of properties they created. */
function visibleScope(tenant: TenantScope): DocumentScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { propertyCreatedById: tenant.userId }),
  };
}

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** `contrato-apto-1-joao-inquilino.pdf` */
function pdfFileName(contract: ContractForDocument): string {
  const parts = [slug(contract.propertyName), slug(contract.tenant.name)].filter(Boolean);
  return `contrato-${parts.join("-") || contract.id.slice(0, 8)}.pdf`;
}

/** The text that goes into each token. The landlord is the property's client or, without one, the organization. */
function placeholderValues(contract: ContractForDocument, today: string): PlaceholderValues {
  const rent = contract.rentTerms!;
  const landlord = contract.landlord ?? { name: contract.organizationName, document: null };
  return {
    locador: landlord.name,
    documento_locador: formatDocument(landlord.document),
    locatario: contract.tenant.name,
    documento_locatario: formatDocument(contract.tenant.document),
    imovel: contract.propertyName,
    endereco: formatAddress(contract.address),
    valor_mensal: formatMoney(centsToNumber(rent.monthlyRentCents)),
    dia_vencimento: String(rent.dueDay),
    indice_reajuste: adjustmentLabel(rent.adjustmentIndex),
    data_inicio: formatDate(toDateOnly(contract.startDate)),
    data_fim: contract.endDate ? formatDate(toDateOnly(contract.endDate)) : "prazo indeterminado",
    data_emissao: formatLongDate(today),
  };
}

/** Service layer: assembles the document. No HTTP, no Prisma. */
export function createContractDocumentsService(
  repository: ContractDocumentsRepository,
  templates: Pick<ContractTemplatesRepository, "find">,
  storage: StorageProvider,
  { today = () => new Date().toISOString().slice(0, 10), compress = true }: ContractDocumentsOptions = {},
): ContractDocumentsService {
  return {
    async generate(tenant, contractId) {
      const scope = visibleScope(tenant);
      const contract = await repository.load(scope, contractId);
      if (!contract) throw AppError.notFound("Contract not found");
      // The template is a rental contract: it talks about monthly rent, due day and adjustment.
      if (contract.contractType !== "conventional" || !contract.rentTerms) {
        throw AppError.businessRule("Only conventional contracts have a PDF");
      }

      const template = (await templates.find(tenant.organizationId)) ?? DEFAULT_TEMPLATE;
      const values = placeholderValues(contract, today());
      const landlord = contract.landlord ?? { name: contract.organizationName, document: null };

      const bytes = await renderContractPdf({
        compress,
        title: `Contrato de locação – ${contract.propertyName}`,
        header: parseBlocks(fillPlaceholders(template.header, values)),
        body: parseBlocks(fillPlaceholders(template.clauses, values)),
        footer: parseBlocks(fillPlaceholders(template.footer, values)),
        signatories: [
          { role: "LOCADOR(A)", name: landlord.name, document: `CPF/CNPJ: ${formatDocument(landlord.document)}` },
          { role: "LOCATÁRIO(A)", name: contract.tenant.name, document: `CPF/CNPJ: ${formatDocument(contract.tenant.document)}` },
        ],
      });

      // The object goes first; if the database refuses, the new object is taken back.
      const fileName = pdfFileName(contract);
      const storageKey = storageKeyFor(tenant.organizationId, "application/pdf");
      await storage.put(storageKey, bytes, { contentType: "application/pdf" });
      let previousStorageKey: string | null;
      try {
        ({ previousStorageKey } = await repository.replacePdf(scope, contractId, {
          uploadedById: tenant.userId,
          storageKey,
          fileName,
          sizeBytes: bytes.length,
        }));
      } catch (error) {
        await storage.delete(storageKey).catch((cleanup) => console.error("Could not remove the orphan object", cleanup));
        throw error;
      }
      // The old PDF's record is gone; if its object cannot be deleted the orphan sweep will find it.
      if (previousStorageKey) {
        await storage.delete(previousStorageKey).catch((error) => console.error("Could not delete the previous PDF", error));
      }

      return { contractId, fileName, sizeBytes: bytes.length, generatedAt: new Date().toISOString(), url: `/api/contracts/${contractId}/pdf` };
    },

    async download(tenant, contractId) {
      const scope = visibleScope(tenant);
      if (!(await repository.load(scope, contractId))) throw AppError.notFound("Contract not found");

      const pdf = await repository.findPdf(scope, contractId);
      if (!pdf) throw AppError.notFound("This contract has no PDF yet. Generate it first.");
      const object = await storage.get(pdf.storageKey);
      if (!object) {
        console.error(`Contract ${contractId} has a PDF record but no object (${pdf.storageKey})`);
        throw AppError.notFound("This contract has no PDF yet. Generate it first.");
      }
      return { bytes: object.body, fileName: pdf.fileName };
    },
  };
}
