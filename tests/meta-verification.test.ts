import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from '../src/integrations/meta/verification.js';

describe('verifyMetaSignature', () => {
  const payload = JSON.stringify({ foo: 'bar' });
  const secret = 'super-secret';

  it('accepts a valid signature', () => {
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyMetaSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects missing or invalid headers', () => {
    expect(verifyMetaSignature(payload, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'sha1=abc', secret)).toBe(false);
  });
});
