import type { CityRecord } from "./lookups.repository.js";
import type { LookupsService, PropertyCatalogEntry } from "./lookups.service.js";

export interface HttpResult<TBody> {
  status: 200;
  body: TBody;
}

export interface LookupsController {
  searchCities(query: { search: string; state?: string; limit: number }): Promise<HttpResult<CityRecord[]>>;
  propertyCatalog(): Promise<HttpResult<PropertyCatalogEntry[]>>;
}

/** Controller layer: receives validated input, calls the service, maps to status + DTO. */
export function createLookupsController(service: LookupsService): LookupsController {
  return {
    async searchCities(query) {
      return { status: 200, body: await service.searchCities(query) };
    },
    async propertyCatalog() {
      return { status: 200, body: await service.propertyCatalog() };
    },
  };
}
