import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { createLocalStorage } from "../../src/lib/storage/local-storage.js";
import { createS3Storage } from "../../src/lib/storage/s3-storage.js";
import { assertSafeKey } from "../../src/lib/storage/storage.js";

describe("storage keys", () => {
  it.each(["a/b.png", "org-1/6f1d7c9e-3b1a-4c55-9a5e-0d4f2f6f8a11.pdf", "file.txt"])("accepts %s", (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  it.each(["../secret", "a/../b", "/absolute", "a//b", "a/.hidden", "", "a b", "a\\b", "x".repeat(501), "..", "a/./b"])(
    "refuses %j",
    (key) => {
      expect(() => assertSafeKey(key)).toThrow();
    },
  );
});

describe("local storage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mybricks-storage-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("stores, reads and deletes an object", async () => {
    const storage = createLocalStorage(dir);
    await storage.put("org/file.bin", Buffer.from("hello"), { contentType: "text/plain" });

    const found = await storage.get("org/file.bin");
    expect(found?.body.toString()).toBe("hello");
    expect(found?.sizeBytes).toBe(5);

    await storage.delete("org/file.bin");
    expect(await storage.get("org/file.bin")).toBeNull();
  });

  it("overwrites an existing key", async () => {
    const storage = createLocalStorage(dir);
    await storage.put("org/same.bin", Buffer.from("one"), { contentType: "text/plain" });
    await storage.put("org/same.bin", Buffer.from("two!"), { contentType: "text/plain" });
    expect((await storage.get("org/same.bin"))?.body.toString()).toBe("two!");
  });

  it("returns null for a key that is not there and deleting it is not an error", async () => {
    const storage = createLocalStorage(dir);
    expect(await storage.get("org/missing.bin")).toBeNull();
    await expect(storage.delete("org/missing.bin")).resolves.toBeUndefined();
  });

  it("keeps binary content intact", async () => {
    const storage = createLocalStorage(dir);
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
    await storage.put("org/binary.bin", bytes, { contentType: "application/octet-stream" });
    expect((await storage.get("org/binary.bin"))?.body.equals(bytes)).toBe(true);
  });

  it("refuses keys that would leave the base folder, without touching the disk", async () => {
    const storage = createLocalStorage(dir);
    await expect(storage.put("../escape.txt", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow("Unsafe");
    await expect(storage.get("../escape.txt")).rejects.toThrow("Unsafe");
    await expect(storage.delete("../escape.txt")).rejects.toThrow("Unsafe");
    expect((await readdir(join(dir, ".."))).includes("escape.txt")).toBe(false);
  });
});

describe("S3 storage", () => {
  it("sends the bucket, key, body and content type on put", async () => {
    const send = vi.fn().mockResolvedValue({});
    await createS3Storage({ bucket: "bricks", client: { send } }).put("org/a.png", Buffer.from("png"), { contentType: "image/png" });

    const command = send.mock.calls[0]![0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "bricks", Key: "org/a.png", ContentType: "image/png" });
    expect(Buffer.from(command.input.Body as Buffer).toString()).toBe("png");
  });

  it("reads the body and the content type on get", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      ContentType: "image/png",
    });
    const found = await createS3Storage({ bucket: "bricks", client: { send } }).get("org/a.png");

    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetObjectCommand);
    expect(found).toEqual({ body: Buffer.from([1, 2, 3]), contentType: "image/png", sizeBytes: 3 });
  });

  it("maps a missing key to null, by error name or by status", async () => {
    const byName = vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { name: "NoSuchKey" }));
    const byStatus = vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { $metadata: { httpStatusCode: 404 } }));
    expect(await createS3Storage({ bucket: "b", client: { send: byName } }).get("org/a.png")).toBeNull();
    expect(await createS3Storage({ bucket: "b", client: { send: byStatus } }).get("org/a.png")).toBeNull();
  });

  it("lets other failures through", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    await expect(createS3Storage({ bucket: "b", client: { send } }).get("org/a.png")).rejects.toThrow("denied");
  });

  it("deletes by bucket and key", async () => {
    const send = vi.fn().mockResolvedValue({});
    await createS3Storage({ bucket: "bricks", client: { send } }).delete("org/a.png");
    const command = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "bricks", Key: "org/a.png" });
  });

  it("refuses unsafe keys before calling the service", async () => {
    const send = vi.fn();
    const storage = createS3Storage({ bucket: "b", client: { send } });
    await expect(storage.put("../x", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow("Unsafe");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("storage settings", () => {
  const base = { DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: "s".repeat(32) };

  it("defaults to the local driver", () => {
    expect(loadEnv(base)).toMatchObject({ STORAGE_DRIVER: "local", STORAGE_DIR: ".data/storage", MAX_UPLOAD_MB: 15 });
  });

  it("asks for the bucket and the credentials when the driver is s3", () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET.*S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/);
  });

  it("accepts a complete s3 configuration", () => {
    const env = loadEnv({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_FORCE_PATH_STYLE: "false" });
    expect(env).toMatchObject({ S3_BUCKET: "b", S3_FORCE_PATH_STYLE: false, S3_REGION: "auto" });
  });

  it("refuses an unknown driver", () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: "ftp" })).toThrow();
  });
});
