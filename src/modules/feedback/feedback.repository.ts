import type { Prisma } from "../../generated/prisma/client.js";
import type { FeedbackStatus } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

const select = {
  id: true,
  message: true,
  status: true,
  createdAt: true,
  userId: true,
  organizationId: true,
  user: { select: { name: true, email: true } },
  organization: { select: { name: true } },
} satisfies Prisma.FeedbackSelect;

export type FeedbackRecord = Prisma.FeedbackGetPayload<{ select: typeof select }>;

export interface FeedbackListQuery {
  status?: FeedbackStatus;
  skip: number;
  take: number;
}

export interface FeedbackRepository {
  create(data: { organizationId: string; userId: string; message: string }): Promise<FeedbackRecord>;
  /** `userId` limits the list to the author's own feedback; without it everything is listed (platform admins). */
  list(filter: { userId?: string }, query: FeedbackListQuery): Promise<{ items: FeedbackRecord[]; total: number }>;
  updateStatus(id: string, status: FeedbackStatus): Promise<FeedbackRecord | null>;
}

/** Repository layer: the only place that talks to Prisma. */
export function createFeedbackRepository(prisma: PrismaClient): FeedbackRepository {
  return {
    create(data) {
      return prisma.feedback.create({ data, select });
    },

    async list({ userId }, { status, skip, take }) {
      const where: Prisma.FeedbackWhereInput = {
        ...(userId ? { userId } : {}),
        ...(status ? { status } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.feedback.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take }),
        prisma.feedback.count({ where }),
      ]);
      return { items, total };
    },

    async updateStatus(id, status) {
      const { count } = await prisma.feedback.updateMany({ where: { id }, data: { status } });
      if (count === 0) return null;
      return prisma.feedback.findUnique({ where: { id }, select });
    },
  };
}
