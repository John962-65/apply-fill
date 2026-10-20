export interface PositionedPdfItem {
  str: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface PdfLayoutInputPage {
  pageNumber: number;
  width?: number;
  height?: number;
  items: PositionedPdfItem[];
}

export type PdfColumnMode = 'single-column' | 'two-column' | 'table' | 'mixed';

export interface PdfLayoutLine {
  id: string;
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  column: 'left' | 'right' | 'full';
  cells?: string[];
  section?: string;
}

export interface PdfLayoutPage {
  page: number;
  width: number;
  height: number;
  mode: Exclude<PdfColumnMode, 'mixed'>;
  lineCount: number;
}

export interface PdfLayoutResult {
  text: string;
  lines: PdfLayoutLine[];
  pages: PdfLayoutPage[];
  mode: PdfColumnMode;
  sectionNames: string[];
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  right: number;
  width: number;
}

interface RawSegment {
  x: number;
  right: number;
  text: string;
}

interface RawLine {
  page: number;
  y: number;
  x: number;
  right: number;
  text: string;
  cells: string[];
  segments: RawSegment[];
}

const LINE_Y_TOLERANCE = 2.2;
const CELL_GAP = 14;
const WORD_GAP = 1.5;
const SECTION_PATTERN =
  /^(?:教育经历|教育背景|学习经历|教育|工作经历|实习经历|工作与实习经历|工作及实习经历|工作经验|实习经验|项目经历|项目经验|科研经历|科研项目|技能证书|技能与证书|专业技能|技能特长|技能清单|奖项|获奖情况|荣誉奖励|所获奖项|补充信息|其他信息|education|experience|workexperience|internship|projects?|projectexperience|skills|certificates?|awards)$/i;

function normalizeSectionName(line: string): string {
  return line
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, '')
    .replace(/^[一二三四五六七八九十]+[、.．]?/, '')
    .replace(/^\d+[、.．)]/, '');
}

export function pdfSectionNameOf(line: string): string | undefined {
  const normalized = normalizeSectionName(line);
  return SECTION_PATTERN.test(normalized) ? normalized : undefined;
}

function toItem(item: PositionedPdfItem): RawItem | undefined {
  if (typeof item.str !== 'string' || item.str.trim() === '') return undefined;
  const width = typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : 0;
  return { str: item.str, x: item.x, y: item.y, right: item.x + width, width };
}

export function groupPdfLines(pageNumber: number, items: PositionedPdfItem[]): RawLine[] {
  const positioned = items
    .map(toItem)
    .filter((item): item is RawItem => item !== undefined)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const buckets: RawItem[][] = [];
  let bucketY: number | undefined;
  for (const item of positioned) {
    if (bucketY === undefined || Math.abs(item.y - bucketY) <= LINE_Y_TOLERANCE) {
      if (bucketY === undefined) bucketY = item.y;
      const active = buckets[buckets.length - 1];
      if (active === undefined) buckets.push([item]);
      else active.push(item);
    } else {
      bucketY = item.y;
      buckets.push([item]);
    }
  }
  return buckets.map((bucket) => {
    const sorted = bucket.slice().sort((a, b) => a.x - b.x);
    const segments: RawSegment[] = [];
    let text = '';
    let segmentX = sorted[0]?.x ?? 0;
    let segmentRight = segmentX;
    let previous: RawItem | undefined;
    const flush = (): void => {
      const trimmed = text.trim();
      if (trimmed !== '') segments.push({ x: segmentX, right: segmentRight, text: trimmed });
      text = '';
    };
    for (const item of sorted) {
      const gap = previous === undefined ? 0 : item.x - previous.right;
      if (previous !== undefined && gap > CELL_GAP) {
        flush();
        segmentX = item.x;
      } else if (previous !== undefined && gap > WORD_GAP) {
        text += ' ';
      }
      text += item.str;
      segmentRight = item.right;
      previous = item;
    }
    flush();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      page: pageNumber,
      y: first?.y ?? 0,
      x: first?.x ?? 0,
      right: last?.right ?? 0,
      text: segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
      cells: segments.map((segment) => segment.text),
      segments,
    };
  }).filter((line) => line.text !== '');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function pageModeOf(lines: RawLine[], width: number): 'single-column' | 'two-column' | 'table' {
  if (lines.length < 3) return 'single-column';
  const split = width > 0 ? width / 2 : (median(lines.map((line) => line.x)) + median(lines.map((line) => line.right))) / 2;
  const segments = lines.flatMap((line) => line.segments);
  const left = segments.filter((segment) => segment.right <= split + 8);
  const right = segments.filter((segment) => segment.x >= split - 8);
  const full = segments.filter((segment) => !left.includes(segment) && !right.includes(segment));
  const tableRows = lines.filter((line) => (line.cells?.length ?? 0) >= 3);
  if (tableRows.length >= 3 && tableRows.length >= Math.ceil(lines.length * 0.4)) {
    return 'table';
  }
  if (left.length >= 3 && right.length >= 3 && full.length <= Math.max(2, segments.length * 0.2)) {
    return 'two-column';
  }
  return 'single-column';
}

function columnOf(line: RawLine, split: number, pageWidth: number): 'left' | 'right' | 'full' {
  if (line.x < split && line.right > split + 8 && line.right - line.x > pageWidth * 0.25) return 'full';
  return line.x >= split ? 'right' : 'left';
}

function toLayoutLine(line: RawLine, index: number, split: number, pageWidth: number, table: boolean): PdfLayoutLine {
  const cells = line.cells ?? [];
  return {
    id: `p${line.page}-l${index + 1}`,
    page: line.page,
    text: table && cells.length > 1 ? cells.join(' | ') : line.text,
    x: line.x,
    y: line.y,
    width: line.right - line.x,
    column: columnOf(line, split, pageWidth),
    ...(cells.length > 1 ? { cells } : {}),
  };
}

function orderTwoColumn(lines: PdfLayoutLine[]): PdfLayoutLine[] {
  const full = lines.filter((line) => line.column === 'full').sort((a, b) => b.y - a.y);
  const left = lines.filter((line) => line.column === 'left').sort((a, b) => b.y - a.y);
  const right = lines.filter((line) => line.column === 'right').sort((a, b) => b.y - a.y);
  const output: PdfLayoutLine[] = [];
  let leftCursor = 0;
  let rightCursor = 0;
  const emitColumnsBetween = (upper: number, lower: number): void => {
    while (leftCursor < left.length && (left[leftCursor]?.y ?? -Infinity) > lower) {
      const line = left[leftCursor];
      if (line === undefined || line.y >= upper) break;
      output.push(line);
      leftCursor += 1;
    }
    while (rightCursor < right.length && (right[rightCursor]?.y ?? -Infinity) > lower) {
      const line = right[rightCursor];
      if (line === undefined || line.y >= upper) break;
      output.push(line);
      rightCursor += 1;
    }
  };
  if (full.length === 0) {
    output.push(...left, ...right);
    return output;
  }
  let upper = Infinity;
  for (const boundary of full) {
    emitColumnsBetween(upper, boundary.y);
    output.push(boundary);
    upper = boundary.y;
  }
  emitColumnsBetween(upper, -Infinity);
  return output;
}

export function formatPdfLayout(pagesInput: PdfLayoutInputPage[]): PdfLayoutResult {
  const layoutPages: PdfLayoutPage[] = [];
  const allLines: PdfLayoutLine[] = [];
  const modes: Array<Exclude<PdfColumnMode, 'mixed'>> = [];
  for (const page of pagesInput) {
    const rawLines = groupPdfLines(page.pageNumber, page.items);
    if (rawLines.length === 0) continue;
    const width = page.width ?? Math.max(...rawLines.map((line) => line.right), 1);
    const split = width / 2;
    const mode = pageModeOf(rawLines, width);
    modes.push(mode);
    const renderLines = mode === 'two-column'
      ? rawLines.flatMap((line): RawLine[] => {
          if (line.segments.length < 2) return [line];
          return line.segments.map((segment) => ({
            page: line.page,
            y: line.y,
            x: segment.x,
            right: segment.right,
            text: segment.text,
            cells: [segment.text],
            segments: [segment],
          }));
        })
      : rawLines;
    const layoutLines = renderLines.map((line, index) => toLayoutLine(line, index, split, width, mode === 'table'));
    const ordered = mode === 'two-column' ? orderTwoColumn(layoutLines) : layoutLines;
    let section: string | undefined;
    for (const line of ordered) {
      const heading = pdfSectionNameOf(line.text.split('|')[0] ?? line.text);
      if (heading !== undefined) {
        section = heading;
        line.section = heading;
      } else if (section !== undefined) {
        line.section = section;
      }
      allLines.push(line);
    }
    layoutPages.push({
      page: page.pageNumber,
      width,
      height: page.height ?? 0,
      mode,
      lineCount: ordered.length,
    });
  }
  const uniqueModes = new Set(modes);
  const mode: PdfColumnMode = uniqueModes.size === 0 ? 'single-column' : uniqueModes.size === 1 ? ([...uniqueModes][0] as Exclude<PdfColumnMode, 'mixed'>) : 'mixed';
  const sectionNames = [...new Set(allLines.map((line) => line.section).filter((name): name is string => name !== undefined))];
  return {
    text: allLines.map((line) => line.text).join('\n'),
    lines: allLines,
    pages: layoutPages,
    mode,
    sectionNames,
  };
}
