import { z } from "zod";
import { AuditAction, AuditEntityType, FeedbackStatus, PropertyType, TransactionType, UsageType } from "../../generated/prisma/enums.js";
import type { AuditLogDto } from "../../modules/audit/audit.dto.js";
import type { ContractPdfDto } from "../../modules/contract-documents/contract-documents.service.js";
import type { TemplateDto } from "../../modules/contract-templates/contract-templates.service.js";
import type { DocumentDto } from "../../modules/documents/documents.dto.js";
import type { AdminFeedbackDto, FeedbackDto } from "../../modules/feedback/feedback.dto.js";
import type { HealthReport } from "../../modules/health/health.service.js";
import type { CityRecord, TransactionCategoryRecord } from "../../modules/lookups/lookups.repository.js";
import type { PropertyCatalogEntry } from "../../modules/lookups/lookups.service.js";
import type { PhotoDto } from "../../modules/photos/photos.dto.js";
import type { AuthContext } from "../../shared/http/app-env.js";
import { nullable, output, pageOf, timestamp } from "./common.js";

// ── files ───────────────────────────────────────────────────────────────────

export const photoSchema = output(
  "Photo",
  z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    position: z.number().int().describe("0 is the cover"),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    contentUrl: z.string().describe("Path of the endpoint that serves the image (the session cookie authenticates it)"),
    createdAt: timestamp,
  }) satisfies z.ZodType<PhotoDto>,
);
export const photoListSchema = output("PhotoList", z.array(photoSchema));

export const documentSchema = output(
  "Document",
  z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    category: nullable(z.string()).describe("Free label: deed, registry, tax, insurance..."),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    contentUrl: z.string().describe("Path of the endpoint that serves the file as a download"),
    createdAt: timestamp,
  }) satisfies z.ZodType<DocumentDto>,
);
export const documentListSchema = output("DocumentList", z.array(documentSchema));

// ── contract template and PDF ───────────────────────────────────────────────

export const contractTemplateSchema = output(
  "ContractTemplate",
  z.object({
    header: z.string().describe("Sanitized HTML"),
    clauses: z.string().describe("Sanitized HTML"),
    footer: z.string().describe("Sanitized HTML"),
    isDefault: z.boolean().describe("true until the organization saves its own"),
    updatedAt: nullable(timestamp),
    updatedById: nullable(z.string()),
    placeholders: z.array(z.object({ token: z.string(), description: z.string() })).describe("The tokens that can be used as {{token}}"),
    unknownPlaceholders: z.array(z.string()).describe("Tokens in the text that are not in the catalog: they appear as typed in the PDF"),
  }) satisfies z.ZodType<TemplateDto>,
);

export const contractPdfSchema = output(
  "ContractPdf",
  z.object({
    contractId: z.uuid(),
    fileName: z.string(),
    sizeBytes: z.number().int(),
    generatedAt: timestamp,
    url: z.string().describe("Path of the endpoint that serves the PDF"),
  }) satisfies z.ZodType<ContractPdfDto>,
);

// ── feedback and audit ──────────────────────────────────────────────────────

const feedbackFields = { id: z.uuid(), message: z.string(), status: z.enum(FeedbackStatus), createdAt: timestamp };
export const feedbackSchema = output("Feedback", z.object(feedbackFields) satisfies z.ZodType<FeedbackDto>);
export const feedbackPageSchema = output("FeedbackPage", pageOf(feedbackSchema));
export const adminFeedbackSchema = output(
  "AdminFeedback",
  z.object({
    ...feedbackFields,
    userId: z.string(),
    userName: z.string(),
    userEmail: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
  }) satisfies z.ZodType<AdminFeedbackDto>,
);
export const adminFeedbackPageSchema = output("AdminFeedbackPage", pageOf(adminFeedbackSchema));

export const auditLogSchema = output(
  "AuditLog",
  z.object({
    id: z.string().describe("Numeric id, as a string (JSON has no 64-bit integers)"),
    organizationId: nullable(z.string()).describe("null marks a platform-level event"),
    actorUserId: nullable(z.string()),
    actorName: nullable(z.string()).describe("Snapshot at the time of the action"),
    actorEmail: nullable(z.string()),
    actorRole: nullable(z.string()),
    impersonatedById: nullable(z.string()).describe("Set when a platform admin acted through impersonation"),
    action: z.enum(AuditAction),
    entityType: nullable(z.enum(AuditEntityType)),
    entityId: nullable(z.string()),
    details: nullable(z.string()).describe("JSON text with the method, path and status of the request"),
    ipAddress: nullable(z.string()),
    userAgent: nullable(z.string()),
    createdAt: timestamp,
  }) satisfies z.ZodType<AuditLogDto>,
);
export const auditLogPageSchema = output("AuditLogPage", pageOf(auditLogSchema));

// ── session, health, reference data ─────────────────────────────────────────

export const sessionSchema = output(
  "Session",
  z.object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      isAnonymous: z.boolean(),
      platformRole: z.string().describe("`user` or `admin` (comma-separated when several)"),
    }),
    sessionId: z.string(),
    impersonatedById: nullable(z.string()).describe("Set while a platform admin is acting as this user"),
    organizationId: nullable(z.string()).describe("The organization the user is working in"),
    memberRole: nullable(z.string()).describe("owner, admin or member in that organization"),
  }) satisfies z.ZodType<AuthContext>,
);

export const healthSchema = output(
  "Health",
  z.object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["up", "down"]),
    uptimeSeconds: z.number().int(),
  }) satisfies z.ZodType<HealthReport>,
);

export const citySchema = output(
  "City",
  z.object({ ibgeCode: z.number().int().describe("7-digit IBGE municipality code"), name: z.string(), state: z.string() }) satisfies z.ZodType<CityRecord>,
);
export const cityListSchema = output("CityList", z.array(citySchema));

export const propertyCatalogSchema = output(
  "PropertyCatalog",
  z.array(
    z.object({
      propertyType: z.enum(PropertyType),
      subtypes: z.array(z.object({ id: z.number().int(), name: z.string() })),
      usageTypes: z.array(z.enum(UsageType)).describe("The usages allowed for this property type"),
    }) satisfies z.ZodType<PropertyCatalogEntry>,
  ),
);

export const transactionCategoryListSchema = output(
  "TransactionCategoryList",
  z.array(
    z.object({ id: z.number().int(), transactionType: z.enum(TransactionType), name: z.string() }) satisfies z.ZodType<TransactionCategoryRecord>,
  ),
);
