import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  type UploadedFile,
  assertAcceptable,
  contentDisposition,
  readUpload,
  safeFileName,
  sniffMime,
  storageKeyFor,
} from "../../src/modules/files/file-upload.js";
import { AppError } from "../../src/shared/errors/app-error.js";

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);

const upload = (bytes: Buffer, mimeType: string, fileName = "f"): UploadedFile => ({ fileName, mimeType, sizeBytes: bytes.length, bytes });
const policy = { allowedTypes: IMAGE_TYPES, maxBytes: 1000 };

describe("sniffMime", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", WEBP, "image/webp"],
    ["PDF", PDF, "application/pdf"],
    ["zip (Office)", ZIP, "application/zip"],
  ])("recognizes %s", (_name, bytes, expected) => {
    expect(sniffMime(bytes)).toBe(expected);
  });

  it("does not take a RIFF container for WebP unless it says WEBP", () => {
    expect(sniffMime(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVEfmt ")]))).toBeNull();
  });

  it.each([["a script", Buffer.from("<script>alert(1)</script>")], ["plain text", Buffer.from("hello")], ["nothing", Buffer.alloc(0)]])(
    "does not recognize %s",
    (_name, bytes) => {
      expect(sniffMime(bytes)).toBeNull();
    },
  );
});

describe("assertAcceptable", () => {
  it("accepts an image whose bytes match its type", () => {
    expect(() => assertAcceptable(upload(PNG, "image/png"), policy)).not.toThrow();
    expect(() => assertAcceptable(upload(JPEG, "image/jpeg"), policy)).not.toThrow();
    expect(() => assertAcceptable(upload(WEBP, "image/webp"), policy)).not.toThrow();
  });

  it("accepts a PDF and Office files under the document policy", () => {
    const documents = { allowedTypes: DOCUMENT_TYPES, maxBytes: 1000 };
    expect(() => assertAcceptable(upload(PDF, "application/pdf"), documents)).not.toThrow();
    expect(() => assertAcceptable(upload(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), documents)).not.toThrow();
    expect(() => assertAcceptable(upload(ZIP, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), documents)).not.toThrow();
  });

  it("refuses an empty file (400)", () => {
    expect(() => assertAcceptable(upload(Buffer.alloc(0), "image/png"), policy)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", status: 400 }),
    );
  });

  it("refuses a file over the limit (413) and says the limit", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2000)]);
    expect(() => assertAcceptable(upload(big, "image/png"), policy)).toThrowError(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE", status: 413, details: { maxBytes: 1000 } }),
    );
  });

  it("accepts a file exactly at the limit", () => {
    const exact = Buffer.concat([PNG, Buffer.alloc(1000 - PNG.length)]);
    expect(() => assertAcceptable(upload(exact, "image/png"), policy)).not.toThrow();
  });

  it("refuses a type that is not allowed (415)", () => {
    expect(() => assertAcceptable(upload(PDF, "application/pdf"), policy)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 }),
    );
    expect(() => assertAcceptable(upload(Buffer.from("x"), "text/html"), policy)).toThrow(AppError);
  });

  it("refuses content that is not what the type claims (415)", () => {
    expect(() => assertAcceptable(upload(Buffer.from("<script>alert(1)</script>"), "image/png"), policy)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_MEDIA_TYPE", message: "The content of the file does not match its type" }),
    );
    expect(() => assertAcceptable(upload(JPEG, "image/png"), policy)).toThrow(AppError);
    expect(() => assertAcceptable(upload(ZIP, "image/png"), policy)).toThrow(AppError);
    expect(() => assertAcceptable(upload(PNG, "application/pdf"), { allowedTypes: DOCUMENT_TYPES, maxBytes: 1000 })).toThrow(AppError);
  });

  it("refuses a zip that claims to be a PDF", () => {
    expect(() => assertAcceptable(upload(ZIP, "application/pdf"), { allowedTypes: DOCUMENT_TYPES, maxBytes: 1000 })).toThrow(AppError);
  });
});

describe("readUpload", () => {
  it("reads the bytes and normalizes the type and the name", async () => {
    const file = new File([PNG], "C:\\Users\\ana\\Fotos\\fachada.PNG", { type: "Image/PNG; charset=binary" });
    const read = await readUpload(file);
    expect(read).toMatchObject({ fileName: "fachada.PNG", mimeType: "image/png", sizeBytes: PNG.length });
    expect(read.bytes.equals(PNG)).toBe(true);
  });
});

describe("storageKeyFor", () => {
  it("is <organization>/<uuid>.<extension> and never contains the client's name", () => {
    const key = storageKeyFor("0c9a8f55-1d5e-4a4e-8d3f-6a8c4f0f2b77", "image/png");
    expect(key).toMatch(/^0c9a8f55-1d5e-4a4e-8d3f-6a8c4f0f2b77\/[0-9a-f-]{36}\.png$/);
  });

  it("is unique every time", () => {
    expect(storageKeyFor("org", "image/png")).not.toBe(storageKeyFor("org", "image/png"));
  });

  it("uses the extension of the type, not of the name", () => {
    expect(storageKeyFor("org", "application/pdf")).toMatch(/\.pdf$/);
    expect(storageKeyFor("org", "image/jpeg")).toMatch(/\.jpg$/);
  });
});

describe("safeFileName", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\temp\\foto.png", "foto.png"],
    ['a"b.png', "ab.png"],
    ["  espaços.png  ", "espaços.png"],
    ["...oculto", "oculto"],
    ["", "file"],
    ["///", "file"],
    ["escritura (2ª via).pdf", "escritura (2ª via).pdf"],
  ])("%j -> %j", (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it("removes control characters", () => {
    expect(safeFileName("a\u0000b\nc.png")).toBe("abc.png");
  });

  it("clips very long names but keeps the extension", () => {
    const name = safeFileName(`${"x".repeat(400)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("carries an ASCII fallback and the real name encoded", () => {
    const header = contentDisposition("attachment", "escritura 2ª via.pdf");
    expect(header).toContain('attachment; filename="escritura 2_ via.pdf"');
    expect(header).toContain("filename*=UTF-8''escritura%202%C2%AA%20via.pdf");
  });

  it("cannot be broken out of with quotes or backslashes", () => {
    expect(contentDisposition("inline", 'a"b\\c.png')).toContain('filename="a_b_c.png"');
  });
});
