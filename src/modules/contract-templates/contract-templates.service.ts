import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { parseBlocks } from "../contract-documents/html-blocks.js";
import type { ContractTemplatesRepository, TemplateRecord } from "./contract-templates.repository.js";
import type { UpdateTemplateInput } from "./contract-templates.schemas.js";
import { DEFAULT_TEMPLATE } from "./default-template.js";
import { PLACEHOLDERS, findUnknownPlaceholders } from "./placeholders.js";
import { sanitizeTemplateHtml } from "./sanitize.js";

/** The template as the editor needs it: the three parts, where they come from and what can be typed. */
export interface TemplateDto {
  header: string;
  clauses: string;
  footer: string;
  /** `true` until the organization saves its own. */
  isDefault: boolean;
  updatedAt: string | null;
  updatedById: string | null;
  placeholders: ReadonlyArray<{ token: string; description: string }>;
  /** Tokens in the text that are not in the catalog: they will appear as typed in the PDF. */
  unknownPlaceholders: string[];
}

export interface ContractTemplatesService {
  get(tenant: TenantScope): Promise<TemplateDto>;
  /** Owners and admins only. The HTML is sanitized before it is stored. */
  update(tenant: TenantScope, input: UpdateTemplateInput): Promise<TemplateDto>;
  /** Owners and admins only: back to the default contract. */
  reset(tenant: TenantScope): Promise<TemplateDto>;
}

function toDto(record: TemplateRecord | null): TemplateDto {
  const parts = record ?? DEFAULT_TEMPLATE;
  return {
    header: parts.header,
    clauses: parts.clauses,
    footer: parts.footer,
    isDefault: record === null,
    updatedAt: record ? record.updatedAt.toISOString() : null,
    updatedById: record?.updatedById ?? null,
    placeholders: PLACEHOLDERS,
    unknownPlaceholders: findUnknownPlaceholders(parts.header, parts.clauses, parts.footer),
  };
}

function assertCanEdit(tenant: TenantScope): void {
  if (!tenant.canSeeAll) throw AppError.forbidden("Only owners and admins can edit the contract template");
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createContractTemplatesService(repository: ContractTemplatesRepository): ContractTemplatesService {
  return {
    async get(tenant) {
      return toDto(await repository.find(tenant.organizationId));
    },

    async update(tenant, input) {
      assertCanEdit(tenant);

      const header = sanitizeTemplateHtml(input.header);
      const clauses = sanitizeTemplateHtml(input.clauses);
      const footer = sanitizeTemplateHtml(input.footer);
      // Sanitizing can leave nothing behind (a template made only of scripts, say).
      if (parseBlocks(clauses).length === 0) {
        throw AppError.validation([{ path: "clauses", message: "The clauses have no text" }]);
      }

      return toDto(await repository.save(tenant.organizationId, tenant.userId, { header, clauses, footer }));
    },

    async reset(tenant) {
      assertCanEdit(tenant);
      await repository.delete(tenant.organizationId);
      return toDto(null);
    },
  };
}
