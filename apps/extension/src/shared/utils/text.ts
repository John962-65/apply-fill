export function normalizeLabel(raw: string): string {
  return raw
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:：*＊?？]+$/u, '')
    .trim()
    .toLowerCase();
}

export function compactChoiceText(raw: string): string {
  return normalizeLabel(raw).replace(/[/／、,，|·\s]+/g, '');
}

export function choiceTextMatches(observed: string, expected: string): boolean {
  const left = compactChoiceText(observed);
  const right = compactChoiceText(expected);
  if (left === '' || right === '') {
    return false;
  }
  return left === right;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}
