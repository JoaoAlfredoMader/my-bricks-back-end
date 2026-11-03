import { z } from "zod";
import { FeedbackStatus } from "../../generated/prisma/enums.js";

export const createFeedbackSchema = z.object({ message: z.string().trim().min(3).max(5000) });

export const updateFeedbackSchema = z.object({ status: z.enum(FeedbackStatus) });

export const listFeedbackQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(FeedbackStatus).optional(),
});

export const feedbackIdParamSchema = z.object({ id: z.uuid() });

export type CreateFeedbackInput = z.output<typeof createFeedbackSchema>;
export type ListFeedbackInput = z.output<typeof listFeedbackQuerySchema>;
