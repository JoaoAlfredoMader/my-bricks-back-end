import type { PhotoRecord } from "./photos.repository.js";

/** Shape returned by the API. The image itself is served by `contentUrl`. */
export interface PhotoDto {
  id: string;
  propertyId: string;
  /** 0 is the cover. */
  position: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Path of the endpoint that serves the image (the session cookie authenticates it). */
  contentUrl: string;
  createdAt: string;
}

export function toPhotoDto(record: PhotoRecord): PhotoDto {
  return {
    id: record.id,
    propertyId: record.propertyId,
    position: record.position,
    fileName: record.file.fileName,
    mimeType: record.file.mimeType,
    sizeBytes: Number(record.file.sizeBytes),
    contentUrl: `/api/properties/${record.propertyId}/photos/${record.id}/content`,
    createdAt: record.createdAt.toISOString(),
  };
}
