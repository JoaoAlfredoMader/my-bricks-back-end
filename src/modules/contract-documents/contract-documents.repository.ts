import type { Prisma } from "../../generated/prisma/client.js";
import type { AdjustmentIndex, ContractType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AddressParts } from "./formatting.js";

const select = {
  id: true,
  contractType: true,
  startDate: true,
  endDate: true,
  pdfFileId: true,
  occupant: { select: { name: true, document: true } },
  rentTerms: { select: { monthlyRentCents: true, dueDay: true, adjustmentIndex: true } },
  property: {
    select: {
      name: true,
      client: { select: { name: true, document: true } },
      address: {
        select: {
          street: true,
          number: true,
          complement: true,
          neighborhood: true,
          postalCode: true,
          city: { select: { name: true, state: true } },
        },
      },
    },
  },
} satisfies Prisma.ContractSelect;

type ContractRow = Prisma.ContractGetPayload<{ select: typeof select }>;

/** Everything the document needs, already flattened. */
export interface ContractForDocument {
  id: string;
  contractType: ContractType;
  startDate: Date;
  endDate: Date | null;
  hasPdf: boolean;
  organizationName: string;
  tenant: { name: string; document: string | null };
  /** The property's client (its owner), if it has one. */
  landlord: { name: string; document: string | null } | null;
  propertyName: string;
  address: AddressParts | null;
  rentTerms: { monthlyRentCents: bigint; dueDay: number; adjustmentIndex: AdjustmentIndex | null } | null;
}

/** Contracts belong to a property: members only reach those of properties they created. */
export interface DocumentScope {
  organizationId: string;
  propertyCreatedById?: string;
}

export interface NewPdfFile {
  uploadedById: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
}

export interface StoredPdf {
  storageKey: string;
  fileName: string;
}

export interface ContractDocumentsRepository {
  load(scope: DocumentScope, contractId: string): Promise<ContractForDocument | null>;
  /**
   * Records the new PDF and makes it the contract's one, in a single transaction. The previous PDF's
   * record is removed and its storage key returned, so the caller can delete the old object.
   */
  replacePdf(scope: DocumentScope, contractId: string, file: NewPdfFile): Promise<{ previousStorageKey: string | null }>;
  findPdf(scope: DocumentScope, contractId: string): Promise<StoredPdf | null>;
}

function whereFor(scope: DocumentScope, contractId: string): Prisma.ContractWhereInput {
  return {
    id: contractId,
    organizationId: scope.organizationId,
    ...(scope.propertyCreatedById ? { property: { createdById: scope.propertyCreatedById } } : {}),
  };
}

function toDocumentData(row: ContractRow, organizationName: string): ContractForDocument {
  const address = row.property.address;
  return {
    id: row.id,
    contractType: row.contractType,
    startDate: row.startDate,
    endDate: row.endDate,
    hasPdf: row.pdfFileId !== null,
    organizationName,
    tenant: row.occupant,
    landlord: row.property.client,
    propertyName: row.property.name,
    address: address && {
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      postalCode: address.postalCode,
      city: address.city.name,
      state: address.city.state,
    },
    rentTerms: row.rentTerms,
  };
}

/** Repository layer: the only place that talks to Prisma. */
export function createContractDocumentsRepository(prisma: PrismaClient): ContractDocumentsRepository {
  return {
    async load(scope, contractId) {
      const row = await prisma.contract.findFirst({ where: whereFor(scope, contractId), select });
      if (!row) return null;
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: scope.organizationId },
        select: { name: true },
      });
      return toDocumentData(row, organization.name);
    },

    replacePdf(scope, contractId, file) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.contract.findFirstOrThrow({
          where: whereFor(scope, contractId),
          select: { pdfFileId: true, pdfFile: { select: { storageKey: true } } },
        });

        const stored = await tx.storedFile.create({
          data: {
            organizationId: scope.organizationId,
            uploadedById: file.uploadedById,
            storageKey: file.storageKey,
            fileName: file.fileName,
            mimeType: "application/pdf",
            sizeBytes: BigInt(file.sizeBytes),
          },
          select: { id: true },
        });
        await tx.contract.update({ where: { id: contractId }, data: { pdfFileId: stored.id } });
        if (current.pdfFileId) await tx.storedFile.delete({ where: { id: current.pdfFileId } });

        return { previousStorageKey: current.pdfFile?.storageKey ?? null };
      });
    },

    async findPdf(scope, contractId) {
      const row = await prisma.contract.findFirst({
        where: whereFor(scope, contractId),
        select: { pdfFile: { select: { storageKey: true, fileName: true } } },
      });
      return row?.pdfFile ?? null;
    },
  };
}
