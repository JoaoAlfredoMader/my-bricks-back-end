/**
 * The tokens a contract template can use. They are written in Portuguese on purpose: the people
 * who edit the template are Brazilian landlords, and they see these words in the editor.
 */
export const PLACEHOLDERS = [
  { token: "locador", description: "Nome do locador (o cliente dono do imóvel ou, sem cliente, a organização)" },
  { token: "documento_locador", description: "CPF ou CNPJ do locador" },
  { token: "locatario", description: "Nome do locatário" },
  { token: "documento_locatario", description: "CPF ou CNPJ do locatário" },
  { token: "imovel", description: "Nome do imóvel" },
  { token: "endereco", description: "Endereço completo do imóvel" },
  { token: "valor_mensal", description: "Valor mensal do aluguel, em reais" },
  { token: "dia_vencimento", description: "Dia do mês em que o aluguel vence" },
  { token: "indice_reajuste", description: "Índice de reajuste anual do aluguel" },
  { token: "data_inicio", description: "Data de início do contrato" },
  { token: "data_fim", description: "Data de término do contrato (ou \"prazo indeterminado\")" },
  { token: "data_emissao", description: "Data em que o PDF foi gerado, por extenso" },
] as const;

export type PlaceholderToken = (typeof PLACEHOLDERS)[number]["token"];
export type PlaceholderValues = Record<PlaceholderToken, string>;

const KNOWN = new Set<string>(PLACEHOLDERS.map((placeholder) => placeholder.token));
/** `{{ token }}`, with optional spaces inside the braces. */
const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replaces the known tokens with their values, HTML-escaped: a tenant named `<b>x</b>` cannot inject
 * markup into the document. Unknown tokens stay as typed, so a typo is visible in the PDF.
 */
export function fillPlaceholders(html: string, values: PlaceholderValues): string {
  return html.replace(TOKEN, (match, token: string) =>
    KNOWN.has(token) ? escapeHtml(values[token as PlaceholderToken]) : match,
  );
}

/** Tokens used in the given texts that are not in the catalog (deduplicated, in order of appearance). */
export function findUnknownPlaceholders(...texts: string[]): string[] {
  const unknown = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(TOKEN)) {
      const token = match[1]!;
      if (!KNOWN.has(token)) unknown.add(token);
    }
  }
  return [...unknown];
}
