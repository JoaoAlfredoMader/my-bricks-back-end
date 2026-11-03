import { randomBytes } from "node:crypto";
import type { ProvisioningRepository } from "./provisioning.repository.js";

export interface ProvisionedUser {
  id: string;
  name: string;
  isAnonymous: boolean;
}

export interface ProvisioningService {
  /** Real users get a personal organization; guests get an expiring demo organization. */
  provisionForNewUser(user: ProvisionedUser): Promise<void>;
  initialOrganizationId(userId: string): Promise<string | null>;
  memberRole(organizationId: string, userId: string): Promise<string | null>;
  /** A guest signed up for real: keep their workspace instead of starting from scratch. */
  adoptDemoWorkspace(anonymousUserId: string, newUser: { id: string; name: string }): Promise<void>;
}

export interface ProvisioningOptions {
  demoTtlHours: number;
}

function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

function uniqueSlug(value: string): string {
  return `${slugify(value)}-${randomBytes(3).toString("hex")}`;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function personalOrganizationName(userName: string): string {
  return `Portfólio de ${firstName(userName)}`;
}

/** Service layer: provisioning rules. No HTTP, no Prisma. */
export function createProvisioningService(
  repository: ProvisioningRepository,
  { demoTtlHours }: ProvisioningOptions,
): ProvisioningService {
  return {
    async provisionForNewUser(user) {
      // Idempotent: a guest that signed up for real may already own an adopted workspace.
      if (await repository.findFirstOrganizationId(user.id)) return;

      const organization = user.isAnonymous
        ? await repository.createOrganizationWithOwner({
            name: "Demonstração",
            slug: uniqueSlug("demo"),
            ownerId: user.id,
            isDemo: true,
            demoExpiresAt: new Date(Date.now() + demoTtlHours * 3_600_000),
          })
        : await repository.createOrganizationWithOwner({
            name: personalOrganizationName(user.name),
            slug: uniqueSlug(personalOrganizationName(user.name)),
            ownerId: user.id,
            isDemo: false,
            demoExpiresAt: null,
          });

      // Better Auth creates the session before this hook runs, so activate the organization here.
      await repository.setActiveOrganizationForSessions(user.id, organization.id);
    },

    initialOrganizationId: (userId) => repository.findFirstOrganizationId(userId),

    memberRole: (organizationId, userId) => repository.findMemberRole(organizationId, userId),

    async adoptDemoWorkspace(anonymousUserId, newUser) {
      await repository.adoptDemoOrganization({
        anonymousUserId,
        newUserId: newUser.id,
        organizationName: personalOrganizationName(newUser.name),
      });
    },
  };
}
