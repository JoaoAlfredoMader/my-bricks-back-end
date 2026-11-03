import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

/** A file received from a multipart form, already read into memory. */
export interface UploadedFile {
  fileName: string;
  /** What the client declared, without parameters (`image/png`, not `image/png; charset=...`). */
  mimeType: string;
  sizeBytes: number;
  bytes: Buffer;
}

export interface UploadPolicy {
  allowedTypes: readonly string[];
  maxBytes: number;
}

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCUMENT_TYPES = ["application/pdf", ...IMAGE_TYPES, DOCX, XLSX] as const;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  [DOCX]: "docx",
  [XLSX]: "xlsx",
};

const startsWith = (bytes: Buffer, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * The type the bytes actually have, judged by their signature. The declared type is only a claim:
 * a script renamed to `.png` must not be stored (and later served) as an image.
 * Office files are zip archives, so they all sniff as `application/zip`.
 */
export function sniffMime(bytes: Buffer): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return null;
}

function sniffMatchesDeclared(sniffed: string | null, declared: string): boolean {
  if (declared === DOCX || declared === XLSX) return sniffed === "application/zip";
  return sniffed === declared;
}

/** Reads a multipart `File` into memory, normalizing the declared type and the name. */
export async function readUpload(file: File): Promise<UploadedFile> {
  return {
    fileName: safeFileName(file.name),
    mimeType: (file.type.split(";")[0] ?? "").trim().toLowerCase(),
    sizeBytes: file.size,
    bytes: Buffer.from(await file.arrayBuffer()),
  };
}

/** Rejects an empty file, a file over the limit, a type that is not allowed or content that is not what it claims to be. */
export function assertAcceptable(upload: UploadedFile, policy: UploadPolicy): void {
  if (upload.sizeBytes === 0) throw AppError.validation([{ path: "file", message: "The file is empty" }]);
  if (upload.sizeBytes > policy.maxBytes) throw AppError.payloadTooLarge(policy.maxBytes);
  if (!policy.allowedTypes.includes(upload.mimeType)) {
    throw AppError.unsupportedMediaType("This file type is not accepted", { allowed: policy.allowedTypes });
  }
  if (!sniffMatchesDeclared(sniffMime(upload.bytes), upload.mimeType)) {
    throw AppError.unsupportedMediaType("The content of the file does not match its type");
  }
}

/** `<organization>/<uuid>.<ext>`: the name the client sent never reaches the storage. */
export function storageKeyFor(organizationId: string, mimeType: string): string {
  const extension = EXTENSIONS[mimeType];
  return `${organizationId}/${randomUUID()}${extension ? `.${extension}` : ""}`;
}

/** Keeps the name readable but harmless: no path, no control characters, at most 255 characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  const clipped = cleaned.length > 255 ? `${cleaned.slice(0, 250)}${cleaned.slice(cleaned.lastIndexOf(".")).slice(0, 5)}` : cleaned;
  return clipped.replace(/^\.+/, "") || "file";
}

/** `Content-Disposition` for a download, with an ASCII fallback and the real name encoded (RFC 5987). */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
