/**
 * A minimal PDF writer.
 *
 * CLAUDE.md §3 locks the stack and does not include a PDF library, and adding
 * one for two documents (the citizen's credit record and the CSR §135 export)
 * would be a dependency we cannot justify on a slide that says we removed four
 * of them. A PDF is a container format; text in one of the fourteen standard
 * fonts needs no library at all.
 *
 * So this writes a real, valid, openable PDF: Helvetica, A4, page breaks, and
 * nothing else. If we ever need tables, images or Devanagari, this is the point
 * at which we would take the dependency — and the reason we would.
 *
 * Devanagari is the honest limitation: Helvetica has no Devanagari glyphs, so
 * non-Latin text is dropped with a visible marker rather than silently rendered
 * as boxes. The citizen's own words live on the web page, which does render them.
 */

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LEADING = 14;

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space above this line. */
  spaceBefore?: number;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** WinAnsi has no Devanagari. Say so on the page rather than emitting boxes. */
function toWinAnsi(s: string): string {
  const cleaned = s.replace(/[^ -ÿ]/g, "");
  const meaningful = s.replace(/\s/g, "").length;
  if (meaningful > 0 && cleaned.replace(/\s/g, "").length < meaningful / 2) {
    return `${cleaned} [text in a non-Latin script; the original is on the web page]`;
  }
  return cleaned;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  // Helvetica averages about 0.5 em per character; 0.52 is a safe estimate that
  // never overflows the margin for the content we put in these documents.
  const perChar = size * 0.52;
  const max = Math.max(8, Math.floor(maxWidth / perChar));
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line.length === 0) line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function renderPdf(lines: PdfLine[], title: string): Buffer {
  const pages: string[] = [];
  let content = "";
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    pages.push(content);
    content = "";
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const line of lines) {
    const size = line.size ?? 10;
    const font = line.bold ? "/F2" : "/F1";
    y -= line.spaceBefore ?? 0;

    for (const chunk of wrap(toWinAnsi(line.text), size, PAGE_WIDTH - MARGIN * 2)) {
      if (y < MARGIN) newPage();
      content += `BT ${font} ${size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm (${escapeText(chunk)}) Tj ET\n`;
      y -= size + (LEADING - 10);
    }
  }
  pages.push(content);

  // Object 1 catalog, 2 pages, 3 font F1, 4 font F2, then per page a page object
  // and a content stream.
  const objects: string[] = [];
  const pageIds: number[] = [];
  let next = 5;
  for (let i = 0; i < pages.length; i++) {
    pageIds.push(next);
    next += 2;
  }

  objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[2] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  pages.forEach((body, i) => {
    const pageId = pageIds[i];
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId] = `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}endstream`;
  });

  let pdf = `%PDF-1.4\n% Milan — ${title}\n`;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i + 1} 0 obj\n${objects[i] ?? "<< >>"}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
