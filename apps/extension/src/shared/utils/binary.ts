// Chrome extension messages use JSON serialization, so binary data must be
// encoded explicitly instead of passing ArrayBuffer through runtime.sendMessage.
export function encodeBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(''));
}

export function decodeBytes(base64: string, expectedSize: number): ArrayBuffer {
  const binary = atob(base64);
  if (binary.length !== expectedSize) {
    throw new Error('ATTACHMENT_SIZE_MISMATCH');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
