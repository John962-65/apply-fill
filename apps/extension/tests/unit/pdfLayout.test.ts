import { describe, expect, it } from 'vitest';

import { formatPdfLayout } from '@/resume/parser/pdfLayout';

function item(str: string, x: number, y: number, width: number) {
  return { str, x, y, width };
}

describe('formatPdfLayout', () => {
  it('双栏按左列完成后右列，且章节标题保持阅读顺序', () => {
    const layout = formatPdfLayout([{
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        item('Experience', 50, 780, 300),
        item('Left one', 50, 750, 200),
        item('Right one', 320, 750, 200),
        item('Left two', 50, 730, 200),
        item('Right two', 320, 730, 200),
        item('Left three', 50, 710, 200),
        item('Right three', 320, 710, 200),
      ],
    }]);
    expect(layout.mode).toBe('two-column');
    expect(layout.sectionNames).toContain('Experience');
    const texts = layout.lines.map((line) => line.text);
    expect(texts.indexOf('Left three')).toBeLessThan(texts.indexOf('Right one'));
    expect(texts).toEqual(['Experience', 'Left one', 'Left two', 'Left three', 'Right one', 'Right two', 'Right three']);
  });

  it('表格行按单元格拆分并保留列结构', () => {
    const layout = formatPdfLayout([{
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        item('School', 40, 700, 100),
        item('Degree', 200, 700, 100),
        item('Year', 400, 700, 80),
        item('A University', 40, 680, 100),
        item('Bachelor', 200, 680, 100),
        item('2020', 400, 680, 80),
        item('B University', 40, 660, 100),
        item('Master', 200, 660, 100),
        item('2022', 400, 660, 80),
      ],
    }]);
    expect(layout.mode).toBe('table');
    expect(layout.lines[0]?.cells).toEqual(['School', 'Degree', 'Year']);
    expect(layout.lines[1]?.text).toBe('A University | Bachelor | 2020');
  });
});
