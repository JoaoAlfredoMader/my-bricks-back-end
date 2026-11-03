import { describe, expect, it, vi } from "vitest";
import { clientIp, createAuditRecorder } from "../../src/modules/audit/audit.recorder.js";
import type { AuditEntry, AuditRepository } from "../../src/modules/audit/audit.repository.js";

function recorderWith(create: AuditRepository["create"]) {
  const repository: AuditRepository = { create, list: vi.fn(), deleteOlderThan: vi.fn() };
  return createAuditRecorder(repository);
}

describe("audit recorder", () => {
  it("stores the actor as a snapshot and fills the missing parts with null", async () => {
    const entries: AuditEntry[] = [];
    const recorder = recorderWith(async (entry) => void entries.push(entry));

    await recorder.record({
      action: "create",
      entityType: "property",
      entityId: "6f1d7c9e-3b1a-4c55-9a5e-0d4f2f6f8a11",
      organizationId: "0c9a8f55-1d5e-4a4e-8d3f-6a8c4f0f2b77",
      actor: { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "create",
      entityType: "property",
      actorName: "Ana",
      actorEmail: "ana@example.com",
      actorRole: "owner",
      impersonatedById: null,
      details: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it("an event without actor or organization is a platform-level event", async () => {
    const entries: AuditEntry[] = [];
    await recorderWith(async (entry) => void entries.push(entry)).record({ action: "login" });
    expect(entries[0]).toMatchObject({ organizationId: null, actorUserId: null, actorName: null, entityId: null });
  });

  it("drops an entity id that is not a uuid instead of failing the write", async () => {
    const entries: AuditEntry[] = [];
    await recorderWith(async (entry) => void entries.push(entry)).record({ action: "delete", entityId: "not-a-uuid" });
    expect(entries[0]?.entityId).toBeNull();
  });

  it("clips values that would not fit their columns", async () => {
    const entries: AuditEntry[] = [];
    await recorderWith(async (entry) => void entries.push(entry)).record({
      action: "login",
      ipAddress: "x".repeat(100),
      userAgent: "y".repeat(900),
      actor: { id: "11111111-1111-4111-8111-111111111111", name: "n".repeat(400), email: "e".repeat(400), role: "r".repeat(300) },
    });
    expect(entries[0]?.ipAddress).toHaveLength(45);
    expect(entries[0]?.userAgent).toHaveLength(500);
    expect(entries[0]?.actorName).toHaveLength(255);
    expect(entries[0]?.actorEmail).toHaveLength(320);
    expect(entries[0]?.actorRole).toHaveLength(100);
  });

  it("never throws when the write fails: losing a line must not break the audited action", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const recorder = recorderWith(async () => {
      throw new Error("database is down");
    });

    await expect(recorder.record({ action: "create" })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

describe("clientIp", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it("takes the first address of x-forwarded-for", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("is null when no proxy header is present", () => {
    expect(clientIp(headers({}))).toBeNull();
  });
});
