import type { PropertyType, TransactionType, UsageType } from "../../../src/generated/prisma/enums.js";

/**
 * Reference data shown to the user, so display names are in pt-BR (like the IBGE city names).
 * Codes (enum values) stay in English.
 */

export const propertySubtypes: ReadonlyArray<{ propertyType: PropertyType; name: string }> = [
  { propertyType: "residential", name: "Apartamento" },
  { propertyType: "residential", name: "Casa" },
  { propertyType: "residential", name: "Cobertura" },

  { propertyType: "commercial", name: "Sala comercial" },
  { propertyType: "commercial", name: "Loja" },
  { propertyType: "commercial", name: "Galpão" },

  { propertyType: "land", name: "Terreno" },
  { propertyType: "land", name: "Lote" },

  { propertyType: "logistics", name: "Galpão logístico" },
  { propertyType: "logistics", name: "Centro de distribuição" },
  { propertyType: "logistics", name: "Armazém" },

  { propertyType: "rural", name: "Fazenda" },
  { propertyType: "rural", name: "Sítio" },
  { propertyType: "rural", name: "Chácara" },
  { propertyType: "rural", name: "Área agrícola" },
  { propertyType: "rural", name: "Área florestal" },

  { propertyType: "parking", name: "Vaga coberta" },
  { propertyType: "parking", name: "Vaga descoberta" },
  { propertyType: "parking", name: "Box" },
];

/** Which usage types are allowed for each property type (enforced by a composite FK). */
export const propertyTypeUsages: ReadonlyArray<{ propertyType: PropertyType; usageType: UsageType }> = [
  { propertyType: "residential", usageType: "rental" },
  { propertyType: "residential", usageType: "short_stay" },
  { propertyType: "residential", usageType: "own_use" },
  { propertyType: "residential", usageType: "loan_for_use" },

  { propertyType: "commercial", usageType: "rental" },
  { propertyType: "commercial", usageType: "concession" },
  { propertyType: "commercial", usageType: "own_use" },

  { propertyType: "land", usageType: "agricultural_lease" },
  { propertyType: "land", usageType: "own_use" },
  { propertyType: "land", usageType: "loan_for_use" },

  { propertyType: "logistics", usageType: "rental" },
  { propertyType: "logistics", usageType: "concession" },

  { propertyType: "rural", usageType: "agricultural_lease" },
  { propertyType: "rural", usageType: "own_use" },
  { propertyType: "rural", usageType: "loan_for_use" },
  { propertyType: "rural", usageType: "rental" },

  { propertyType: "parking", usageType: "rental" },
  { propertyType: "parking", usageType: "own_use" },
  { propertyType: "parking", usageType: "loan_for_use" },
];

/** Only non-operational items: rent, condo and property tax live on the property / contract. */
export const transactionCategories: ReadonlyArray<{ transactionType: TransactionType; name: string }> = [
  { transactionType: "revenue", name: "Venda de imóvel" },
  { transactionType: "revenue", name: "Reembolso de sinistro" },
  { transactionType: "revenue", name: "Multa rescisória" },
  { transactionType: "revenue", name: "Indenização" },
  { transactionType: "revenue", name: "Outros" },

  { transactionType: "expense", name: "Parcela de financiamento" },
  { transactionType: "expense", name: "Reforma" },
  { transactionType: "expense", name: "Obra" },
  { transactionType: "expense", name: "Multa contratual" },
  { transactionType: "expense", name: "Honorários" },
  { transactionType: "expense", name: "Imposto de renda (ganho de capital)" },
  { transactionType: "expense", name: "Outros" },
];
