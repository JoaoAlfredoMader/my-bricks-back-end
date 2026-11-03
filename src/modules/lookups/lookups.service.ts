import type { PropertyType, UsageType } from "../../generated/prisma/enums.js";
import type { CityRecord, LookupsRepository, TransactionCategoryRecord } from "./lookups.repository.js";

export interface PropertyCatalogEntry {
  propertyType: PropertyType;
  subtypes: Array<{ id: number; name: string }>;
  usageTypes: UsageType[];
}

export interface LookupsService {
  /** Revenue and expense categories; the category decides whether a transaction is revenue or expense. */
  transactionCategories(): Promise<TransactionCategoryRecord[]>;
  searchCities(query: { search: string; state?: string; limit: number }): Promise<CityRecord[]>;
  /** For each property type: its subtypes and the usages allowed for it. Drives the property form. */
  propertyCatalog(): Promise<PropertyCatalogEntry[]>;
}

/** Service layer: shapes reference data for the forms. No HTTP, no Prisma. */
export function createLookupsService(repository: LookupsRepository): LookupsService {
  return {
    searchCities: (query) => repository.searchCities(query),

    transactionCategories: () => repository.listTransactionCategories(),

    async propertyCatalog() {
      const [subtypes, usages] = await Promise.all([
        repository.listPropertySubtypes(),
        repository.listPropertyTypeUsages(),
      ]);

      const catalog = new Map<PropertyType, PropertyCatalogEntry>();
      const entryFor = (propertyType: PropertyType) => {
        let entry = catalog.get(propertyType);
        if (!entry) {
          entry = { propertyType, subtypes: [], usageTypes: [] };
          catalog.set(propertyType, entry);
        }
        return entry;
      };
      for (const subtype of subtypes) entryFor(subtype.propertyType).subtypes.push({ id: subtype.id, name: subtype.name });
      for (const usage of usages) entryFor(usage.propertyType).usageTypes.push(usage.usageType);

      return [...catalog.values()];
    },
  };
}
