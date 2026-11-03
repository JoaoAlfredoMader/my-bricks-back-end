import PDFDocument from "pdfkit";
import type { Block, TextRun } from "./html-blocks.js";

export interface Signatory {
  role: string;
  name: string;
  document: string;
}

export interface ContractPdfInput {
  /** Document title (shown in the PDF properties). */
  title: string;
  header: readonly Block[];
  body: readonly Block[];
  footer: readonly Block[];
  signatories: readonly Signatory[];
  /** Turn off the stream compression to inspect the text in tests. */
  compress?: boolean;
}

const PAGE = { margins: { top: 64, bottom: 72, left: 72, right: 72 } } as const;
const BODY_SIZE = 11;

/** pdfkit ships the 14 standard fonts, which cover Portuguese (WinAnsi) without embedding anything. */
function fontFor(run: Pick<TextRun, "bold" | "italic">): string {
  if (run.bold && run.italic) return "Helvetica-BoldOblique";
  if (run.bold) return "Helvetica-Bold";
  if (run.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

type Align = "left" | "center" | "justify";

function writeBlock(doc: PDFKit.PDFDocument, block: Block, align: Align): void {
  if (block.kind === "heading") {
    const size = block.level === 1 ? 15 : block.level === 2 ? 12 : 11;
    doc.moveDown(block.level === 1 ? 0.2 : 0.6);
    doc.font("Helvetica-Bold").fontSize(size);
    doc.text(block.runs.map((run) => run.text).join(""), { align: block.level === 1 ? "center" : align });
    doc.moveDown(0.3);
    return;
  }

  doc.fontSize(BODY_SIZE);
  const runs: TextRun[] = block.marker ? [{ text: `${block.marker} `, bold: false, italic: false, underline: false }, ...block.runs] : block.runs;
  runs.forEach((run, index) => {
    doc.font(fontFor(run)).text(run.text, {
      continued: index < runs.length - 1,
      underline: run.underline,
      align,
      ...(block.kind === "listItem" ? { indent: 14 } : {}),
    });
  });
  doc.moveDown(0.6);
}

function writeSignatures(doc: PDFKit.PDFDocument, signatories: readonly Signatory[]): void {
  if (signatories.length === 0) return;
  const needed = 130;
  if (doc.y > doc.page.height - doc.page.margins.bottom - needed) doc.addPage();

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const gap = 30;
  const column = (width - gap * (signatories.length - 1)) / signatories.length;
  const top = doc.y + 56;

  signatories.forEach((signatory, index) => {
    const x = left + index * (column + gap);
    doc.moveTo(x, top).lineTo(x + column, top).lineWidth(0.7).stroke();
    doc.font("Helvetica-Bold").fontSize(10).text(signatory.role, x, top + 6, { width: column, align: "center" });
    doc.font("Helvetica").fontSize(10).text(signatory.name, x, doc.y, { width: column, align: "center" });
    doc.fontSize(9).text(signatory.document, x, doc.y, { width: column, align: "center" });
  });
  doc.x = left;
  doc.y = top + 80;
}

/** Writes "Página i de n" in the bottom margin of every page. */
function writePageNumbers(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    // Writing inside the bottom margin would otherwise open a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text(`Página ${index + 1} de ${range.count}`, 0, doc.page.height - 40, { align: "center", width: doc.page.width });
    doc.page.margins.bottom = bottom;
  }
}

/** Renders the contract as an A4 PDF: header, clauses, signature lines, footer and page numbers. */
export function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: PAGE.margins,
    bufferPages: true,
    compress: input.compress ?? true,
    info: { Title: input.title, Author: "MyBricks", Creator: "MyBricks" },
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  for (const block of input.header) writeBlock(doc, block, "center");
  doc.moveDown(0.5);
  for (const block of input.body) writeBlock(doc, block, "justify");
  writeSignatures(doc, input.signatories);
  for (const block of input.footer) writeBlock(doc, block, "center");
  writePageNumbers(doc);

  doc.end();
  return finished;
}
