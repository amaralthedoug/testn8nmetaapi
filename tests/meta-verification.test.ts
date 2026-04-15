import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaChallenge, verifyMetaSignature } from '../src/integrations/meta/verification.js';

describe('verifyMetaChallenge', () => {
  it('accepts exact matching token', () => {
    expect(verifyMetaChallenge('subscribe', 'correct-token', 'challenge', 'correct-token')).toBe('challenge');
  });

  it('rejects token that is a prefix of expected', () => {
    expect(verifyMetaChallenge('subscribe', 'correct-token-prefix', 'challenge', 'correct-token-prefix-extra')).toBeNull();
  });

  it('rejects when mode is not subscribe', () => {
    expect(verifyMetaChallenge('unsubscribe', 'correct-token', 'challenge', 'correct-token')).toBeNull();
  });

  it('rejects when token is undefined', () => {
    expect(verifyMetaChallenge('subscribe', undefined, 'challenge', 'correct-token')).toBeNull();
  });

  it('rejects when challenge is undefined', () => {
    expect(verifyMetaChallenge('subscribe', 'correct-token', undefined, 'correct-token')).toBeNull();
  });

  it('rejects wrong token', () => {
    expect(verifyMetaChallenge('subscribe', 'wrong-token', 'challenge', 'correct-token')).toBeNull();
  });
});

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
