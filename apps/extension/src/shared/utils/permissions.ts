export function hostPermissionPattern(url: string | undefined): string | undefined {
  if (url === undefined || url === '') {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.hostname === '') {
      return undefined;
    }
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return undefined;
  }
}
