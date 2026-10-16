let fallbackCounter = 0;

export function createId(prefix: string): string {
  const globalCrypto = globalThis.crypto;
  if (typeof globalCrypto?.randomUUID === 'function') {
    return `${prefix}_${globalCrypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${fallbackCounter.toString(36)}`;
}
