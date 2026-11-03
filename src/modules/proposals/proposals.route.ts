import { Hono } from "hono";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppEnv } from "../../shared/http/app-env.js";
import { requireAuth } from "../../shared/http/auth.middleware.js";
import { tenantScope } from "../../shared/http/tenant.js";
import { validate } from "../../shared/http/validate.js";
import { createProposalsController } from "./proposals.controller.js";
import { createProposalsRepository } from "./proposals.repository.js";
import {
  createProposalSchema,
  listProposalsQuerySchema,
  propertyParamSchema,
  proposalParamsSchema,
  updateProposalSchema,
} from "./proposals.schemas.js";
import { createProposalsService } from "./proposals.service.js";

/** Route layer. Mounted under `/api/properties/:propertyId/proposals`. */
export function createProposalsRoutes(prisma: PrismaClient) {
  const controller = createProposalsController(createProposalsService(createProposalsRepository(prisma)));

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", validate("param", propertyParamSchema), validate("query", listProposalsQuerySchema), async (c) => {
      const { body } = await controller.list(tenantScope(c), c.req.valid("param").propertyId, c.req.valid("query"));
      return c.json(body);
    })
    .post("/", validate("param", propertyParamSchema), validate("json", createProposalSchema), async (c) => {
      const { status, body } = await controller.create(tenantScope(c), c.req.valid("param").propertyId, c.req.valid("json"));
      return c.json(body, status);
    })
    .get("/:id", validate("param", proposalParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      const { body } = await controller.get(tenantScope(c), propertyId, id);
      return c.json(body);
    })
    .patch("/:id", validate("param", proposalParamsSchema), validate("json", updateProposalSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      const { body } = await controller.update(tenantScope(c), propertyId, id, c.req.valid("json"));
      return c.json(body);
    })
    .delete("/:id", validate("param", proposalParamsSchema), async (c) => {
      const { propertyId, id } = c.req.valid("param");
      await controller.remove(tenantScope(c), propertyId, id);
      return c.body(null, 204);
    });
}
