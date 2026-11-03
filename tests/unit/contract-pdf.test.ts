import { describe, expect, it } from "vitest";
import { renderContractPdf } from "../../src/modules/contract-documents/contract-pdf.js";
import {
  adjustmentLabel,
  formatAddress,
  formatDate,
  formatDocument,
  formatLongDate,
  formatMoney,
} from "../../src/modules/contract-documents/formatting.js";
import { blocksToText, parseBlocks } from "../../src/modules/contract-documents/html-blocks.js";
import { DEFAULT_TEMPLATE } from "../../src/modules/contract-templates/default-template.js";
import {
  PLACEHOLDERS,
  type PlaceholderValues,
  escapeHtml,
  fillPlaceholders,
  findUnknownPlaceholders,
} from "../../src/modules/contract-templates/placeholders.js";
import { countPdfPages, extractPdfText, looksLikePdf, pdfContains, pdfInfo } from "../helpers/pdf.js";

const values = Object.fromEntries(PLACEHOLDERS.map(({ token }) => [token, `<${token}>`])) as PlaceholderValues;

describe("placeholders", () => {
  it("replaces every known token, with or without spaces inside the braces", () => {
    expect(fillPlaceholders("{{locador}} e {{ locatario }}", { ...values, locador: "Ana", locatario: "João" })).toBe("Ana e João");
  });

  it("escapes the values so they cannot inject markup", () => {
    const filled = fillPlaceholders("<p>{{locatario}}</p>", { ...values, locatario: `<script>alert("x")</script> & 'co'` });
    expect(filled).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;co&#39;</p>");
  });

  it("does not expand a token that a value happens to contain", () => {
    expect(fillPlaceholders("{{locador}}", { ...values, locador: "{{locatario}}" })).toBe("{{locatario}}");
  });

  it("leaves unknown tokens as typed, so a typo is visible", () => {
    expect(fillPlaceholders("{{locador}} {{locatário}} {{foo}}", { ...values, locador: "Ana" })).toBe("Ana {{locatário}} {{foo}}");
  });

  it("lists the unknown tokens once each, in order of appearance", () => {
    expect(findUnknownPlaceholders("{{foo}} {{locador}} {{bar}}", "{{foo}} {{baz}}")).toEqual(["foo", "bar", "baz"]);
    expect(findUnknownPlaceholders("{{locador}} {{ valor_mensal }}")).toEqual([]);
  });

  it("every placeholder has a description", () => {
    expect(PLACEHOLDERS.every((placeholder) => placeholder.description.length > 10)).toBe(true);
  });

  it("the default template only uses known tokens", () => {
    expect(findUnknownPlaceholders(DEFAULT_TEMPLATE.header, DEFAULT_TEMPLATE.clauses, DEFAULT_TEMPLATE.footer)).toEqual([]);
  });

  it("escapeHtml handles the five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("formatting", () => {
  it("money in reais with the Brazilian separators", () => {
    expect(formatMoney(350_000)).toBe("R$ 3.500,00");
    expect(formatMoney(5)).toBe("R$ 0,05");
    expect(formatMoney(123_456_789)).toBe("R$ 1.234.567,89");
  });

  it("dates, short and long", () => {
    expect(formatDate("2026-03-05")).toBe("05/03/2026");
    expect(formatLongDate("2026-11-03")).toBe("3 de novembro de 2026");
    expect(formatLongDate("2026-03-01")).toBe("1 de março de 2026");
  });

  it("CPF and CNPJ, numeric and alphanumeric", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatDocument(null)).toBe("não informado");
    expect(formatDocument("123")).toBe("123");
  });

  it("the address skips what is missing", () => {
    expect(formatAddress({ street: "Rua A", number: "100", complement: "apto 2", neighborhood: "Centro", city: "Campinas", state: "SP", postalCode: "13015-904" }))
      .toBe("Rua A, 100, apto 2, Centro, Campinas/SP, CEP 13015-904");
    expect(formatAddress({ street: "Rua A", number: null, complement: null, neighborhood: null, city: "Campinas", state: "SP", postalCode: null })).toBe("Rua A, Campinas/SP");
    expect(formatAddress(null)).toBe("endereço não informado");
  });

  it("the adjustment index in words", () => {
    expect(adjustmentLabel("igpm")).toBe("IGP-M");
    expect(adjustmentLabel("ipca")).toBe("IPCA");
    expect(adjustmentLabel("other")).toBe("índice acordado entre as partes");
    expect(adjustmentLabel(null)).toBe("sem reajuste previsto");
  });
});

describe("parseBlocks", () => {
  it("makes a block per paragraph and heading", () => {
    const blocks = parseBlocks("<h1>Título</h1><p>Um.</p><p>Dois.</p>");
    expect(blocks.map((block) => [block.kind, block.level ?? null])).toEqual([["heading", 1], ["paragraph", null], ["paragraph", null]]);
    expect(blocksToText(blocks)).toBe("Título\nUm.\nDois.");
  });

  it("keeps bold, italic and underline per run, nested or not", () => {
    const [block] = parseBlocks("<p>a <strong>b <em>c</em></strong> <u>d</u> e</p>");
    expect(block!.runs.map((run) => [run.text, run.bold, run.italic, run.underline])).toEqual([
      ["a ", false, false, false],
      ["b ", true, false, false],
      ["c", true, true, false],
      [" ", false, false, false],
      ["d", false, false, true],
      [" e", false, false, false],
    ]);
  });

  it("treats b and i like strong and em", () => {
    const [block] = parseBlocks("<p><b>x</b><i>y</i></p>");
    expect(block!.runs.map((run) => [run.bold, run.italic])).toEqual([[true, false], [false, true]]);
  });

  it("bullets unordered lists and numbers ordered ones, restarting per list", () => {
    const blocks = parseBlocks("<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol><ol><li>e</li></ol>");
    expect(blocks.map((block) => block.marker)).toEqual(["•", "•", "1.", "2.", "1."]);
    expect(blocks.every((block) => block.kind === "listItem")).toBe(true);
  });

  it("collapses whitespace like a browser and trims the edges of a block", () => {
    expect(blocksToText(parseBlocks("<p>  muito \n\n  espaço   aqui  </p>"))).toBe("muito espaço aqui");
  });

  it("keeps a hard break inside the paragraph", () => {
    expect(blocksToText(parseBlocks("<p>linha 1<br>linha 2</p>"))).toBe("linha 1\nlinha 2");
  });

  it("decodes entities", () => {
    expect(blocksToText(parseBlocks("<p>A &amp; B &lt; C &nbsp;D</p>"))).toContain("A & B < C");
  });

  it("turns bare text into a paragraph and drops empty blocks", () => {
    expect(blocksToText(parseBlocks("solto <p></p><p>   </p><p>dentro</p>"))).toBe("solto\ndentro");
  });

  it("is empty for nothing", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("   \n  ")).toEqual([]);
  });

  it("ignores tags it does not know but keeps their text", () => {
    expect(blocksToText(parseBlocks("<p>a <span>b</span> c</p>"))).toBe("a b c");
  });
});

describe("renderContractPdf", () => {
  const base = {
    title: "Contrato",
    header: parseBlocks("<h1>CONTRATO DE LOCAÇÃO</h1>"),
    body: parseBlocks("<p>O <strong>LOCATÁRIO</strong> pagará R$ 3.500,00 todo mês – ação de despejo.</p><ul><li>item um</li></ul>"),
    footer: parseBlocks("<p><em>Rodapé do contrato</em></p>"),
    signatories: [
      { role: "LOCADOR(A)", name: "Ana Souza", document: "CPF 529.982.247-25" },
      { role: "LOCATÁRIO(A)", name: "João Inquilino", document: "CPF 168.995.350-09" },
    ],
    compress: false,
  } as const;

  it("produces a valid one-page A4 PDF", async () => {
    const pdf = await renderContractPdf(base);
    expect(looksLikePdf(pdf)).toBe(true);
    expect(countPdfPages(pdf)).toBe(1);
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 595.28 841.89]");
  });

  it("writes the text with Portuguese accents intact", async () => {
    const pdf = await renderContractPdf(base);
    for (const expected of ["CONTRATO DE LOCAÇÃO", "LOCATÁRIO", "R$ 3.500,00", "ação de despejo", "item um", "Rodapé do contrato"]) {
      expect(pdfContains(pdf, expected), expected).toBe(true);
    }
  });

  it("writes the signature block with the names and documents", async () => {
    const pdf = await renderContractPdf(base);
    for (const expected of ["LOCADOR(A)", "Ana Souza", "CPF 529.982.247-25", "LOCATÁRIO(A)", "João Inquilino", "CPF 168.995.350-09"]) {
      expect(pdfContains(pdf, expected), expected).toBe(true);
    }
  });

  it("numbers the pages", async () => {
    expect(extractPdfText(await renderContractPdf(base))).toContain("Página 1 de 1");
  });

  it("sets the document properties", async () => {
    const pdf = await renderContractPdf(base);
    expect(pdfInfo(pdf, "Title")).toBe("Contrato");
    expect(pdfInfo(pdf, "Author")).toBe("MyBricks");
  });

  it("flows a long contract over several pages and numbers each one", async () => {
    const paragraphs = Array.from({ length: 60 }, (_, index) => `<p>Cláusula ${index + 1}: ${"texto do contrato ".repeat(25)}</p>`).join("");
    const pdf = await renderContractPdf({ ...base, body: parseBlocks(paragraphs) });
    const pages = countPdfPages(pdf);
    expect(pages).toBeGreaterThan(2);

    expect(pdfContains(pdf, `Página 1 de ${pages}`)).toBe(true);
    expect(pdfContains(pdf, `Página ${pages} de ${pages}`)).toBe(true);
    expect(pdfContains(pdf, "Cláusula 60")).toBe(true);
  });

  it("never loses the signature block, whatever the length of the body", async () => {
    for (let lines = 0; lines <= 48; lines += 2) {
      const body = parseBlocks(Array.from({ length: lines }, () => "<p>linha de enchimento do contrato</p>").join(""));
      const pdf = await renderContractPdf({ ...base, body });
      expect(pdfContains(pdf, "Ana Souza") && pdfContains(pdf, "João Inquilino"), `with ${lines} lines`).toBe(true);
    }
  });

  it("renders without signatories, footer or header", async () => {
    const pdf = await renderContractPdf({ title: "x", header: [], body: parseBlocks("<p>só o corpo</p>"), footer: [], signatories: [], compress: false });
    expect(looksLikePdf(pdf)).toBe(true);
    expect(extractPdfText(pdf)).toContain("só o corpo");
  });

  it("compresses by default, which makes the file smaller", async () => {
    const body = parseBlocks(Array.from({ length: 30 }, () => `<p>${"texto repetido ".repeat(30)}</p>`).join(""));
    const plain = await renderContractPdf({ ...base, body });
    const compressed = await renderContractPdf({ ...base, body, compress: true });
    expect(looksLikePdf(compressed)).toBe(true);
    expect(compressed.length).toBeLessThan(plain.length);
  });

  it("renders the default template filled with values", async () => {
    const filled = { ...values, locador: "Ana Souza", locatario: "João Inquilino", valor_mensal: "R$ 3.500,00", data_inicio: "01/01/2026" };
    const pdf = await renderContractPdf({
      title: "Contrato",
      header: parseBlocks(fillPlaceholders(DEFAULT_TEMPLATE.header, filled)),
      body: parseBlocks(fillPlaceholders(DEFAULT_TEMPLATE.clauses, filled)),
      footer: parseBlocks(fillPlaceholders(DEFAULT_TEMPLATE.footer, filled)),
      signatories: [],
      compress: false,
    });
    for (const expected of ["CONTRATO DE LOCAÇÃO", "Ana Souza", "João Inquilino", "R$ 3.500,00", "Cláusula 3ª – Do aluguel", "01/01/2026"]) {
      expect(pdfContains(pdf, expected), expected).toBe(true);
    }
    expect(extractPdfText(pdf)).not.toContain("{{");
  });
});
