import type { FeedbackStatus } from "../../generated/prisma/enums.js";
import type { FeedbackRecord } from "./feedback.repository.js";

/** What the author sees of their own feedback. */
export interface FeedbackDto {
  id: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
}

/** What the platform operator sees: who sent it and from which organization. */
export interface AdminFeedbackDto extends FeedbackDto {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

export function toFeedbackDto(record: FeedbackRecord): FeedbackDto {
  return {
    id: record.id,
    message: record.message,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toAdminFeedbackDto(record: FeedbackRecord): AdminFeedbackDto {
  return {
    ...toFeedbackDto(record),
    userId: record.userId,
    userName: record.user.name,
    userEmail: record.user.email,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
  };
}
