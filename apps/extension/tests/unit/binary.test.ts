import { describe, expect, it } from 'vitest';

import { decodeBytes, encodeBytes } from '@/shared/utils/binary';

describe('attachment message serialization', () => {
  it('preserves every byte through Chrome JSON messages, including large binary files', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    const message = JSON.parse(JSON.stringify({ dataBase64: encodeBytes(bytes.buffer), size: bytes.length }));
    expect(new Uint8Array(decodeBytes(message.dataBase64, message.size))).toEqual(bytes);
  });

  it('rejects truncated attachment data', () => {
    expect(() => decodeBytes('AQID', 4)).toThrow('ATTACHMENT_SIZE_MISMATCH');
  });
});
