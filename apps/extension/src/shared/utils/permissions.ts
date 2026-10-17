export const PERMISSION_REQUEST_TIMEOUT_MS = 12_000;

export function requestPermissionWithTimeout(
  request: Promise<boolean>,
  timeoutMs: number = PERMISSION_REQUEST_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

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
