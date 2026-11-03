import { Parser } from "htmlparser2";

export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface Block {
  kind: "paragraph" | "heading" | "listItem";
  /** Heading level, 1 to 3. */
  level?: 1 | 2 | 3;
  /** The bullet or number in front of a list item. */
  marker?: string;
  runs: TextRun[];
}

const HEADINGS = new Set(["h1", "h2", "h3"]);

/**
 * Turns the sanitized HTML subset of a template (p, h1-h3, ul/ol/li, br, strong/b, em/i, u) into
 * blocks of formatted text runs, which is all the PDF renderer needs. Whitespace is collapsed the
 * way a browser would; text outside any block becomes a paragraph.
 */
export function parseBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const lists: Array<{ ordered: boolean; count: number }> = [];
  const format = { bold: 0, italic: 0, underline: 0 };
  let current: Block | null = null;

  const open = (block: Block) => {
    close();
    current = block;
  };
  const close = () => {
    if (!current) return;
    // Trim the edges of the block, then keep it only if something is left.
    const runs = current.runs;
    if (runs.length > 0) runs[0]!.text = runs[0]!.text.replace(/^\s+/, "");
    if (runs.length > 0) runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.replace(/\s+$/, "");
    current.runs = runs.filter((run) => run.text.length > 0);
    if (current.runs.length > 0) blocks.push(current);
    current = null;
  };
  const addText = (text: string) => {
    if (!current) open({ kind: "paragraph", runs: [] });
    current!.runs.push({ text, bold: format.bold > 0, italic: format.italic > 0, underline: format.underline > 0 });
  };

  const parser = new Parser(
    {
      onopentag(name) {
        if (name === "p") open({ kind: "paragraph", runs: [] });
        else if (HEADINGS.has(name)) open({ kind: "heading", level: Number(name[1]) as 1 | 2 | 3, runs: [] });
        else if (name === "ul" || name === "ol") {
          close();
          lists.push({ ordered: name === "ol", count: 0 });
        } else if (name === "li") {
          const list = lists.at(-1);
          if (list) list.count += 1;
          open({ kind: "listItem", marker: list?.ordered ? `${list.count}.` : "•", runs: [] });
        } else if (name === "br") addText("\n");
        else if (name === "strong" || name === "b") format.bold += 1;
        else if (name === "em" || name === "i") format.italic += 1;
        else if (name === "u") format.underline += 1;
      },
      onclosetag(name) {
        if (name === "p" || HEADINGS.has(name) || name === "li") close();
        else if (name === "ul" || name === "ol") {
          close();
          lists.pop();
        } else if (name === "strong" || name === "b") format.bold = Math.max(0, format.bold - 1);
        else if (name === "em" || name === "i") format.italic = Math.max(0, format.italic - 1);
        else if (name === "u") format.underline = Math.max(0, format.underline - 1);
      },
      ontext(text) {
        // Collapse whitespace like a browser, except around hard breaks that were added explicitly.
        const collapsed = text.replace(/\s+/g, " ");
        if (collapsed === " " && !current) return;
        if (collapsed.length > 0) addText(collapsed);
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  close();
  return blocks;
}

/** The plain text of some blocks, for previews and for tests. */
export function blocksToText(blocks: readonly Block[]): string {
  return blocks.map((block) => `${block.marker ? `${block.marker} ` : ""}${block.runs.map((run) => run.text).join("")}`).join("\n");
}
