import { normalizeLabel } from './text';

export type DatePart = 'year' | 'month' | 'day';

export function isAlternateNameLabel(label: string): boolean {
  return /英文|拼音|english|pinyin|first\s*name|last\s*name|surname|family\s*name/i.test(label);
}

/** Remove a bilingual translation only when the Chinese title is unambiguous. */
export function canonicalFieldLabel(raw: string): string {
  const text = normalizeLabel(raw.normalize('NFKC')).replace(/^[*＊\s]+/, '');
  if (isAlternateNameLabel(text) && /姓名|名字|name/i.test(text)) return text;
  const translation = /\s*[/|｜]\s*(?=[a-z])/i.exec(text);
  return translation && /[\u3400-\u9fff]/.test(text.slice(0, translation.index))
    ? text.slice(0, translation.index).trim() : text;
}

export function datePartOfLabel(raw: string): DatePart | undefined {
  const label = canonicalFieldLabel(raw);
  if (!/出生|生日|入学|毕业|开始|结束|起始|截止|日期|时间|birth|date|start|end/i.test(label)) return undefined;
  const part = /[(（]\s*(年|月|日|year|month|day|date)\s*[)）]\s*$/i.exec(label)?.[1]?.toLowerCase();
  return part === '年' || part === 'year' ? 'year' : part === '月' || part === 'month' ? 'month' :
    part === '日' || part === 'day' || part === 'date' ? 'day' : undefined;
}
