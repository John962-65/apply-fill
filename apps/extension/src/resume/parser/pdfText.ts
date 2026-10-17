export interface PdfTextResult {
  ok: boolean;
  text: string;
  pageCount: number;
  empty: boolean;
  error?: string;
}

interface PositionedText {
  str: string;
  x: number;
  y: number;
  right: number;
}

const LINE_Y_TOLERANCE = 2;
const ITEM_GAP_TOLERANCE = 1.5;
const EMPTY_TEXT_THRESHOLD = 20;

function toPositioned(item: unknown): PositionedText | undefined {
  if (item === null || typeof item !== 'object') {
    return undefined;
  }
  const candidate = item as { str?: unknown; transform?: unknown; width?: unknown };
  if (typeof candidate.str !== 'string' || candidate.str.trim() === '') {
    return undefined;
  }
  const transform = Array.isArray(candidate.transform) ? candidate.transform : [];
  const xRaw = transform[4];
  const yRaw = transform[5];
  const x = typeof xRaw === 'number' ? xRaw : 0;
  const y = typeof yRaw === 'number' ? yRaw : 0;
  const width = typeof candidate.width === 'number' ? candidate.width : 0;
  return { str: candidate.str, x, y: Math.round(y), right: x + width };
}

function joinLine(items: PositionedText[]): string {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  let line = '';
  let previousRight: number | undefined;
  for (const item of sorted) {
    if (previousRight !== undefined && item.x - previousRight > ITEM_GAP_TOLERANCE) {
      line += ' ';
    }
    line += item.str;
    previousRight = item.right;
  }
  return line.replace(/\s+/g, ' ').trim();
}

function groupLines(items: unknown[]): string[] {
  const positioned = items
    .map((item) => toPositioned(item))
    .filter((item): item is PositionedText => item !== undefined);
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let bucket: PositionedText[] = [];
  let bucketY: number | undefined;
  const flush = (): void => {
    if (bucket.length > 0) {
      const line = joinLine(bucket);
      if (line !== '') {
        lines.push(line);
      }
      bucket = [];
    }
  };
  for (const item of positioned) {
    if (bucketY === undefined || Math.abs(item.y - bucketY) <= LINE_Y_TOLERANCE) {
      if (bucketY === undefined) {
        bucketY = item.y;
      }
      bucket.push(item);
    } else {
      flush();
      bucket = [item];
      bucketY = item.y;
    }
  }
  flush();
  return lines;
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
    const lines: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        lines.push(...groupLines(content.items));
      }
    } finally {
      await doc.destroy();
    }
    const text = lines.join('\n');
    const compact = text.replace(/\s/g, '');
    return { ok: true, text, pageCount, empty: compact.length < EMPTY_TEXT_THRESHOLD };
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
