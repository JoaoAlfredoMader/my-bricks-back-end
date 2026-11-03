import { describe, expect, it, vi } from "vitest";
import type { StorageProvider } from "../../src/lib/storage/storage.js";
import type { UploadedFile } from "../../src/modules/files/file-upload.js";
import type { PhotosRepository } from "../../src/modules/photos/photos.repository.js";
import { MAX_PHOTOS_PER_PROPERTY, createPhotosService } from "../../src/modules/photos/photos.service.js";
import type { TenantScope } from "../../src/shared/http/tenant.js";
import { PNG } from "../helpers/fixtures.js";

const tenant: TenantScope = { organizationId: "org-1", userId: "user-1", canSeeAll: true };
const upload: UploadedFile = { fileName: "fachada.png", mimeType: "image/png", sizeBytes: PNG.length, bytes: PNG };

type MockedRepository = { [Method in keyof PhotosRepository]: ReturnType<typeof vi.fn> };

function setup(overrides: Partial<Record<keyof PhotosRepository, ReturnType<typeof vi.fn>>> = {}) {
  const repository: MockedRepository = {
    propertyVisible: vi.fn().mockResolvedValue(true),
    count: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    create: vi.fn().mockResolvedValue({
      id: "photo-1", propertyId: "prop-1", position: 0, createdAt: new Date("2026-01-01T00:00:00Z"),
      file: { storageKey: "k", fileName: "fachada.png", mimeType: "image/png", sizeBytes: 12n },
    }),
    reorder: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  } satisfies StorageProvider;
  return { repository, storage, service: createPhotosService(repository as unknown as PhotosRepository, storage, { maxUploadBytes: 1000 }) };
}

describe("photo upload", () => {
  it("puts the object first and records it under the same key", async () => {
    const { repository, storage, service } = setup();
    await service.upload(tenant, "prop-1", upload);

    const key = storage.put.mock.calls[0]![0] as string;
    expect(key).toMatch(/^org-1\/[0-9a-f-]{36}\.png$/);
    expect(repository.create.mock.calls[0]![2]).toMatchObject({ storageKey: key, uploadedById: "user-1", fileName: "fachada.png" });
    expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(repository.create.mock.invocationCallOrder[0]!);
  });

  it("takes the object back when the database refuses, and still reports the failure", async () => {
    const { storage, service } = setup({ create: vi.fn().mockRejectedValue(new Error("database is down")) });
    await expect(service.upload(tenant, "prop-1", upload)).rejects.toThrow("database is down");

    const stored = storage.put.mock.calls[0]![0];
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it("still reports the database failure when taking the object back fails too", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage, service } = setup({ create: vi.fn().mockRejectedValue(new Error("database is down")) });
    storage.delete.mockRejectedValue(new Error("storage is down"));

    await expect(service.upload(tenant, "prop-1", upload)).rejects.toThrow("database is down");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("writes nothing when the storage refuses", async () => {
    const { repository, storage, service } = setup();
    storage.put.mockRejectedValue(new Error("storage is down"));
    await expect(service.upload(tenant, "prop-1", upload)).rejects.toThrow("storage is down");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("touches neither the storage nor the database for a file that fails the checks", async () => {
    const { repository, storage, service } = setup();
    await expect(service.upload(tenant, "prop-1", { ...upload, bytes: Buffer.from("<script>"), sizeBytes: 8 })).rejects.toMatchObject({ status: 415 });
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("stops at the photo limit with a business rule error", async () => {
    const { storage, service } = setup({ count: vi.fn().mockResolvedValue(MAX_PHOTOS_PER_PROPERTY) });
    await expect(service.upload(tenant, "prop-1", upload)).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION", status: 422 });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("does not look for a property the caller cannot see", async () => {
    const { storage, service } = setup({ propertyVisible: vi.fn().mockResolvedValue(false) });
    await expect(service.upload(tenant, "prop-1", upload)).rejects.toMatchObject({ status: 404 });
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe("photo removal", () => {
  it("deletes the object after the rows", async () => {
    const { repository, storage, service } = setup({ delete: vi.fn().mockResolvedValue({ storageKey: "org-1/a.png" }) });
    await service.remove(tenant, "prop-1", "photo-1");
    expect(storage.delete).toHaveBeenCalledWith("org-1/a.png");
    expect(repository.delete.mock.invocationCallOrder[0]).toBeLessThan(storage.delete.mock.invocationCallOrder[0]!);
  });

  it("succeeds even when the object cannot be deleted: the orphan sweep takes it later", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage, service } = setup({ delete: vi.fn().mockResolvedValue({ storageKey: "org-1/a.png" }) });
    storage.delete.mockRejectedValue(new Error("storage is down"));

    await expect(service.remove(tenant, "prop-1", "photo-1")).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("leaves the storage alone when there is no such photo", async () => {
    const { storage, service } = setup({ delete: vi.fn().mockResolvedValue(null) });
    await expect(service.remove(tenant, "prop-1", "photo-1")).rejects.toMatchObject({ status: 404 });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe("photo content", () => {
  const record = { id: "photo-1", propertyId: "prop-1", position: 0, createdAt: new Date(), file: { storageKey: "org-1/a.png", fileName: "a.png", mimeType: "image/png", sizeBytes: 3n } };

  it("serves the stored bytes with the type recorded in the database", async () => {
    const { storage, service } = setup({ findById: vi.fn().mockResolvedValue(record) });
    storage.get.mockResolvedValue({ body: PNG, contentType: null, sizeBytes: PNG.length });
    expect(await service.content(tenant, "prop-1", "photo-1")).toEqual({ bytes: PNG, mimeType: "image/png", fileName: "a.png" });
  });

  it("is a 404 when the row exists but the object is gone", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage, service } = setup({ findById: vi.fn().mockResolvedValue(record) });
    storage.get.mockResolvedValue(null);
    await expect(service.content(tenant, "prop-1", "photo-1")).rejects.toMatchObject({ status: 404 });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("photo ordering", () => {
  const photo = (id: string) => ({ id, propertyId: "prop-1", position: 0, createdAt: new Date(), file: { storageKey: "k", fileName: "f", mimeType: "image/png", sizeBytes: 1n } });

  it.each([
    ["a missing photo", ["a", "b"]],
    ["a duplicate", ["a", "a", "b"]],
    ["an unknown photo", ["a", "b", "x"]],
  ])("refuses %s", async (_name, ids) => {
    const { repository, service } = setup({ list: vi.fn().mockResolvedValue([photo("a"), photo("b"), photo("c")]) });
    await expect(service.reorder(tenant, "prop-1", ids)).rejects.toMatchObject({ status: 400 });
    expect(repository.reorder).not.toHaveBeenCalled();
  });

  it("applies a complete permutation", async () => {
    const { repository, service } = setup({ list: vi.fn().mockResolvedValue([photo("a"), photo("b"), photo("c")]) });
    await service.reorder(tenant, "prop-1", ["c", "a", "b"]);
    expect(repository.reorder).toHaveBeenCalledWith(expect.anything(), "prop-1", ["c", "a", "b"]);
  });
});
