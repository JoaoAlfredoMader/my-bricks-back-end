import { describe, expect, it, vi } from "vitest";
import type { ProvisioningRepository } from "../../src/modules/auth/provisioning.repository.js";
import { createProvisioningService } from "../../src/modules/auth/provisioning.service.js";
import type { DemoSeeder } from "../../src/modules/demo/demo-workspace.js";

function setup(seeder?: DemoSeeder) {
  const repository = {
    createOrganizationWithOwner: vi.fn().mockResolvedValue({ id: "org-1" }),
    findFirstOrganizationId: vi.fn().mockResolvedValue(null),
    findMemberRole: vi.fn(),
    setActiveOrganizationForSessions: vi.fn().mockResolvedValue(undefined),
    adoptDemoOrganization: vi.fn(),
  };
  const service = createProvisioningService(repository as unknown as ProvisioningRepository, {
    demoTtlHours: 24,
    ...(seeder ? { demoSeeder: seeder } : {}),
  });
  return { repository, service };
}

describe("provisioning with demo data", () => {
  it("fills a guest's demo workspace after it is created and activated", async () => {
    const seed = vi.fn().mockResolvedValue(undefined);
    const { repository, service } = setup({ seed });
    await service.provisionForNewUser({ id: "guest-1", name: "Guest", isAnonymous: true });

    expect(seed).toHaveBeenCalledWith({ organizationId: "org-1", ownerUserId: "guest-1" });
    expect(repository.setActiveOrganizationForSessions.mock.invocationCallOrder[0]).toBeLessThan(seed.mock.invocationCallOrder[0]!);
  });

  it("never fills a real user's personal organization", async () => {
    const seed = vi.fn();
    const { service } = setup({ seed });
    await service.provisionForNewUser({ id: "user-1", name: "Ana Souza", isAnonymous: false });
    expect(seed).not.toHaveBeenCalled();
  });

  it("does not seed again when the user already has an organization", async () => {
    const seed = vi.fn();
    const { repository, service } = setup({ seed });
    repository.findFirstOrganizationId.mockResolvedValue("org-0");
    await service.provisionForNewUser({ id: "guest-1", name: "Guest", isAnonymous: true });
    expect(seed).not.toHaveBeenCalled();
  });

  it("a failing seed leaves the guest with a working, empty workspace instead of a failed sign-in", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { repository, service } = setup({ seed: vi.fn().mockRejectedValue(new Error("the city table is empty")) });

    await expect(service.provisionForNewUser({ id: "guest-1", name: "Guest", isAnonymous: true })).resolves.toBeUndefined();
    expect(repository.setActiveOrganizationForSessions).toHaveBeenCalledWith("guest-1", "org-1");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("works without a seeder at all", async () => {
    const { repository, service } = setup();
    await expect(service.provisionForNewUser({ id: "guest-1", name: "Guest", isAnonymous: true })).resolves.toBeUndefined();
    expect(repository.createOrganizationWithOwner).toHaveBeenCalledWith(expect.objectContaining({ isDemo: true, name: "Demonstração" }));
  });
});
