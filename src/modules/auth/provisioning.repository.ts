import type { PrismaClient } from "../../lib/prisma.js";

export interface NewOrganization {
  name: string;
  slug: string;
  ownerId: string;
  isDemo: boolean;
  demoExpiresAt: Date | null;
}

export interface ProvisioningRepository {
  createOrganizationWithOwner(input: NewOrganization): Promise<{ id: string }>;
  findFirstOrganizationId(userId: string): Promise<string | null>;
  findMemberRole(organizationId: string, userId: string): Promise<string | null>;
  /** Points every session of the user to the organization (sessions are created before provisioning runs). */
  setActiveOrganizationForSessions(userId: string, organizationId: string): Promise<void>;
  /**
   * Moves the guest's demo workspace to the real account the guest just created:
   * the empty personal organization of the new user is dropped, the memberships are
   * transferred (authorship foreign keys follow through ON UPDATE CASCADE), the demo flag
   * is cleared and the new user's sessions point to the adopted organization.
   */
  adoptDemoOrganization(input: { anonymousUserId: string; newUserId: string; organizationName: string }): Promise<string | null>;
}

/** Repository layer: the only place of the auth module that talks to Prisma. */
export function createProvisioningRepository(prisma: PrismaClient): ProvisioningRepository {
  return {
    async createOrganizationWithOwner({ name, slug, ownerId, isDemo, demoExpiresAt }) {
      const organization = await prisma.organization.create({
        data: { name, slug, isDemo, demoExpiresAt, members: { create: { userId: ownerId, role: "owner" } } },
        select: { id: true },
      });
      return organization;
    },

    async findFirstOrganizationId(userId) {
      const membership = await prisma.member.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true },
      });
      return membership?.organizationId ?? null;
    },

    async findMemberRole(organizationId, userId) {
      const membership = await prisma.member.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true },
      });
      return membership?.role ?? null;
    },

    async setActiveOrganizationForSessions(userId, organizationId) {
      await prisma.session.updateMany({ where: { userId }, data: { activeOrganizationId: organizationId } });
    },

    async adoptDemoOrganization({ anonymousUserId, newUserId, organizationName }) {
      return prisma.$transaction(async (tx) => {
        const demo = await tx.member.findFirst({
          where: { userId: anonymousUserId, organization: { isDemo: true } },
          orderBy: { createdAt: "asc" },
          select: { organizationId: true },
        });
        if (!demo) return null;

        const personal = await tx.member.findMany({
          where: { userId: newUserId, role: "owner", organization: { isDemo: false } },
          select: { organizationId: true },
        });
        for (const { organizationId } of personal) {
          const [properties, clients, occupants, files] = await Promise.all([
            tx.property.count({ where: { organizationId } }),
            tx.client.count({ where: { organizationId } }),
            tx.occupant.count({ where: { organizationId } }),
            tx.storedFile.count({ where: { organizationId } }),
          ]);
          if (properties + clients + occupants + files === 0) {
            await tx.organization.delete({ where: { id: organizationId } });
          }
        }

        await tx.member.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } });
        await tx.organization.update({
          where: { id: demo.organizationId },
          data: { isDemo: false, demoExpiresAt: null, name: organizationName },
        });
        await tx.session.updateMany({ where: { userId: newUserId }, data: { activeOrganizationId: demo.organizationId } });
        return demo.organizationId;
      });
    },
  };
}
