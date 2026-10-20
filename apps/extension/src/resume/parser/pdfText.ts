import type { PdfColumnMode, PdfLayoutInputPage, PdfLayoutLine, PdfLayoutPage, PositionedPdfItem } from './pdfLayout';
import { formatPdfLayout } from './pdfLayout';

export interface PdfTextResult {
  ok: boolean;
  text: string;
  pageCount: number;
  empty: boolean;
  error?: string;
  lines?: PdfLayoutLine[];
  pages?: PdfLayoutPage[];
  layout?: PdfColumnMode;
  sectionNames?: string[];
}

const EMPTY_TEXT_THRESHOLD = 20;

function toPositioned(item: unknown): PositionedPdfItem | undefined {
  if (item === null || typeof item !== 'object') {
    return undefined;
  }
  const candidate = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
  if (typeof candidate.str !== 'string' || candidate.str.trim() === '') {
    return undefined;
  }
  const transform = Array.isArray(candidate.transform) ? candidate.transform : [];
  const xRaw = transform[4];
  const yRaw = transform[5];
  const x = typeof xRaw === 'number' ? xRaw : 0;
  const y = typeof yRaw === 'number' ? yRaw : 0;
  return {
    str: candidate.str,
    x,
    y,
    width: typeof candidate.width === 'number' ? candidate.width : 0,
    height: typeof candidate.height === 'number' ? candidate.height : 0,
  };
}

export async function extractPdfText(bytes: ArrayBuffer): Promise<PdfTextResult> {
  try {
    const [pdfjs, workerModule] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
    const data = new Uint8Array(bytes.slice(0));
    const doc = await pdfjs.getDocument({ data }).promise;
    const pageCount = doc.numPages;
    const pages: PdfLayoutInputPage[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items: content.items
            .map((item) => toPositioned(item))
            .filter((item): item is PositionedPdfItem => item !== undefined),
        });
      }
    } finally {
      await doc.destroy();
    }
    const layout = formatPdfLayout(pages);
    const compact = layout.text.replace(/\s/g, '');
    return {
      ok: true,
      text: layout.text,
      pageCount,
      empty: compact.length < EMPTY_TEXT_THRESHOLD,
      lines: layout.lines,
      pages: layout.pages,
      layout: layout.mode,
      sectionNames: layout.sectionNames,
    };
  } catch (error) {
    return {
      ok: false,
      text: '',
      pageCount: 0,
      empty: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
