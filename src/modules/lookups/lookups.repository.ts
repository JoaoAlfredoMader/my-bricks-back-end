import { Prisma } from "../../generated/prisma/client.js";
import type { PropertyType, TransactionType, UsageType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../lib/prisma.js";

export interface CityRecord {
  ibgeCode: number;
  name: string;
  state: string;
}

export interface PropertySubtypeRecord {
  id: number;
  propertyType: PropertyType;
  name: string;
}

export interface PropertyTypeUsageRecord {
  propertyType: PropertyType;
  usageType: UsageType;
}

export interface TransactionCategoryRecord {
  id: number;
  transactionType: TransactionType;
  name: string;
}

export interface LookupsRepository {
  listTransactionCategories(): Promise<TransactionCategoryRecord[]>;
  searchCities(query: { search: string; state?: string; limit: number }): Promise<CityRecord[]>;
  listPropertySubtypes(): Promise<PropertySubtypeRecord[]>;
  listPropertyTypeUsages(): Promise<PropertyTypeUsageRecord[]>;
}

/** Keeps `%`, `_` and `\` typed by the user from acting as LIKE wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Repository layer: reference data shared by every organization (no tenant filter). */
export function createLookupsRepository(prisma: PrismaClient): LookupsRepository {
  return {
    searchCities({ search, state, limit }) {
      // Raw query for unaccent(): users type "sao paulo" and expect "São Paulo".
      const pattern = `%${escapeLike(search)}%`;
      const stateFilter = state ? Prisma.sql`AND state = ${state}` : Prisma.empty;
      return prisma.$queryRaw<CityRecord[]>`
        SELECT ibge_code AS "ibgeCode", name, state
        FROM cities
        WHERE unaccent(name) ILIKE unaccent(${pattern}) ${stateFilter}
        ORDER BY name, state
        LIMIT ${limit}`;
    },

    listTransactionCategories() {
      return prisma.transactionCategory.findMany({ orderBy: [{ transactionType: "asc" }, { name: "asc" }] });
    },

    listPropertySubtypes() {
      return prisma.propertySubtype.findMany({ orderBy: [{ propertyType: "asc" }, { name: "asc" }] });
    },

    listPropertyTypeUsages() {
      return prisma.propertyTypeUsage.findMany();
    },
  };
}
