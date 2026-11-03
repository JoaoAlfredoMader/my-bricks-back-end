import type { DocumentRecord } from "./documents.repository.js";

/** Shape returned by the API. The file itself is downloaded from `contentUrl`. */
export interface DocumentDto {
  id: string;
  propertyId: string;
  /** Free label: deed, registry, tax, insurance... */
  category: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Path of the endpoint that serves the file (the session cookie authenticates it). */
  contentUrl: string;
  createdAt: string;
}

export function toDocumentDto(record: DocumentRecord): DocumentDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    category: record.category,
    fileName: record.file.fileName,
    mimeType: record.file.mimeType,
    sizeBytes: Number(record.file.sizeBytes),
    contentUrl: `/api/properties/${record.propertyId}/documents/${record.id}/content`,
    createdAt: record.createdAt.toISOString(),
  };
}
