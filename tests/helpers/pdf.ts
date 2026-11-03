/**
 * Reads the text out of a PDF written with `compress: false` and the standard fonts: pdfkit writes
 * it as hexadecimal WinAnsi strings inside `[...] TJ` operators. Enough to assert on content
 * without a PDF parser.
 */
export function extractPdfText(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  const decoder = new TextDecoder("windows-1252");
  const runs: string[] = [];

  for (const operator of source.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const hex = [...operator[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((part) => part[1]!).join("");
    runs.push(decoder.decode(Buffer.from(hex, "hex")));
  }
  return runs.join("");
}

/**
 * Justified text is written word by word with no space between the operators, so compare without
 * whitespace: `contains(pdf, "Cláusula 60")` finds `Cláusula60` too.
 */
export function pdfContains(pdf: Buffer, expected: string): boolean {
  const compact = (value: string) => value.replace(/\s+/g, "");
  return compact(extractPdfText(pdf)).includes(compact(expected));
}

/** A string of the document information dictionary (`Title`, `Author`...): an indirect object holding `(text)`. */
export function pdfInfo(pdf: Buffer, key: string): string | null {
  const source = pdf.toString("latin1");
  const reference = new RegExp(`/${key} (\\d+) 0 R`).exec(source);
  if (!reference) return null;
  const object = new RegExp(`\\n${reference[1]} 0 obj\\n\\(([^)]*)\\)\\nendobj`).exec(source);
  return object ? object[1]! : null;
}

export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

export const looksLikePdf = (bytes: Buffer): boolean =>
  bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.toString("latin1").includes("%%EOF");
