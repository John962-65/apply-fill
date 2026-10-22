/** Small ASCII PDF fixture: real page objects and streams, parsed by the extension's PDF reader. */
export function makePdfPages(pages: string[][]): Buffer {
  const escape = (text: string): string => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((lines, index) => {
    const content = 'BT /F1 12 Tf 72 760 Td 16 TL\n' + lines.map((line) => `(${escape(line)}) Tj T*`).join('\n') + '\nET';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  return serializePdf(objects);
}

/** Identity font + explicit Unicode map, so Chinese fixture text goes through the real PDF extractor. */
export function makeUnicodePdf(lines: string[]): Buffer {
  const hex = (text: string): string => Buffer.from(text, 'utf16le').swap16().toString('hex');
  const chars = [...new Set(lines.join('').split(''))];
  const mappings: string[] = [];
  for (let offset = 0; offset < chars.length; offset += 100) {
    const chunk = chars.slice(offset, offset + 100);
    mappings.push(`${chunk.length} beginbfchar\n${chunk.map((char) => `<${hex(char)}> <${hex(char)}>`).join('\n')}\nendbfchar`);
  }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /FixtureUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${mappings.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const content = 'BT /F1 8 Tf 38 800 Td 13 TL\n' + lines.map((line) => `<${hex(line)}> Tj T*`).join('\n') + '\nET';
  return serializePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 1000 /CIDToGIDMap /Identity >>',
    '<< /Type /FontDescriptor /FontName /Fixture /Flags 4 /FontBBox [0 -200 1000 900] /Ascent 800 /Descent -200 /CapHeight 700 /ItalicAngle 0 /StemV 80 >>',
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

function serializePdf(objects: string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length; pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
