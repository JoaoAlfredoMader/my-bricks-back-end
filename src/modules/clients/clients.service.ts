import type { PersonType } from "../../generated/prisma/enums.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { TenantScope } from "../../shared/http/tenant.js";
import { isValidCnpj, isValidCpf } from "../../shared/validation/brazilian-document.js";
import { type ClientDto, type Page, toClientDto } from "./clients.dto.js";
import type { ClientData, ClientScope, ClientsRepository } from "./clients.repository.js";
import type { CreateClientInput, ListClientsInput, UpdateClientInput } from "./clients.schemas.js";

export interface ClientsService {
  list(tenant: TenantScope, query: ListClientsInput): Promise<Page<ClientDto>>;
  get(tenant: TenantScope, id: string): Promise<ClientDto>;
  create(tenant: TenantScope, input: CreateClientInput): Promise<ClientDto>;
  update(tenant: TenantScope, id: string, input: UpdateClientInput): Promise<ClientDto>;
  remove(tenant: TenantScope, id: string): Promise<void>;
}

/** Owners and admins see the whole organization; members only the clients they created. */
function visibleScope(tenant: TenantScope): ClientScope {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.canSeeAll ? {} : { createdById: tenant.userId }),
  };
}

/** An individual is identified by a CPF, a company by a CNPJ. */
function assertDocumentMatchesPersonType(personType: PersonType, document: string | null): void {
  if (document === null) return;
  const valid = personType === "individual" ? isValidCpf(document) : isValidCnpj(document);
  if (!valid) {
    throw AppError.validation(
      [{ path: "document", message: personType === "individual" ? "Invalid CPF" : "Invalid CNPJ" }],
    );
  }
}

/** Service layer: business rules. No HTTP, no Prisma. */
export function createClientsService(repository: ClientsRepository): ClientsService {
  return {
    async list(tenant, { page, pageSize, search, personType }) {
      const { items, total } = await repository.list(visibleScope(tenant), {
        ...(search ? { search } : {}),
        ...(personType ? { personType } : {}),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toClientDto), page, pageSize, total };
    },

    async get(tenant, id) {
      const client = await repository.findById(visibleScope(tenant), id);
      if (!client) throw AppError.notFound("Client not found");
      return toClientDto(client);
    },

    async create(tenant, input) {
      const data: ClientData = {
        name: input.name,
        personType: input.personType,
        document: input.document ?? null,
        email: input.email ?? null,
        whatsapp: input.whatsapp ?? null,
      };
      assertDocumentMatchesPersonType(data.personType, data.document);

      const created = await repository.create(
        { organizationId: tenant.organizationId, createdById: tenant.userId },
        data,
      );
      return toClientDto(created);
    },

    async update(tenant, id, input) {
      const scope = visibleScope(tenant);
      const current = await repository.findById(scope, id);
      if (!current) throw AppError.notFound("Client not found");

      const patch: Partial<ClientData> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.personType !== undefined) patch.personType = input.personType;
      if (input.document !== undefined) patch.document = input.document;
      if (input.email !== undefined) patch.email = input.email;
      if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp;

      // The pair must stay consistent after the change, even when only one side is sent.
      assertDocumentMatchesPersonType(
        patch.personType ?? current.personType,
        patch.document !== undefined ? patch.document : current.document,
      );

      const updated = await repository.update(scope, id, patch);
      if (!updated) throw AppError.notFound("Client not found");
      return toClientDto(updated);
    },

    async remove(tenant, id) {
      const scope = visibleScope(tenant);
      const client = await repository.findById(scope, id);
      if (!client) throw AppError.notFound("Client not found");

      const properties = await repository.countProperties(scope, id);
      if (properties > 0) {
        throw AppError.conflict("Client still has properties. Move or remove them first.", { properties });
      }
      await repository.delete(scope, id);
    },
  };
}
