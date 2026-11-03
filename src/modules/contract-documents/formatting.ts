import type { AdjustmentIndex } from "../../generated/prisma/enums.js";

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const LONG_DATE = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** `350000` -> `R$ 3.500,00` (a plain space instead of the non-breaking one, which the PDF fonts render oddly). */
export function formatMoney(cents: number): string {
  return MONEY.format(cents / 100).replace(/ /g, " ");
}

/** `2026-03-05` -> `05/03/2026`. */
export function formatDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

/** `2026-11-03` -> `3 de novembro de 2026`. */
export function formatLongDate(isoDate: string): string {
  return LONG_DATE.format(new Date(`${isoDate}T00:00:00.000Z`));
}

/** CPF `000.000.000-00`, CNPJ `00.000.000/0000-00`; anything else is shown as stored. */
export function formatDocument(document: string | null): string {
  if (!document) return "não informado";
  if (/^\d{11}$/.test(document)) return document.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (/^[0-9A-Z]{12}\d{2}$/.test(document)) return document.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
  return document;
}

const ADJUSTMENT_LABELS: Record<AdjustmentIndex, string> = {
  igpm: "IGP-M",
  ipca: "IPCA",
  inpc: "INPC",
  igpdi: "IGP-DI",
  other: "índice acordado entre as partes",
};

export function adjustmentLabel(index: AdjustmentIndex | null): string {
  return index ? ADJUSTMENT_LABELS[index] : "sem reajuste previsto";
}

export interface AddressParts {
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string | null;
}

/** `Rua A, 100, apto 2, Centro, Campinas/SP, CEP 13015-904`. */
export function formatAddress(address: AddressParts | null): string {
  if (!address) return "endereço não informado";
  const parts = [address.street, address.number, address.complement, address.neighborhood, `${address.city}/${address.state}`];
  const line = parts.filter((part): part is string => Boolean(part)).join(", ");
  return address.postalCode ? `${line}, CEP ${address.postalCode}` : line;
}
