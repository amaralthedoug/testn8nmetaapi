import crypto from 'crypto';

export const verifyMetaChallenge = (
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
  expectedToken: string
): string | null => {
  if (mode !== 'subscribe' || !token || !challenge) return null;

  // SECURITY: Use timing-safe comparison to prevent token enumeration via timing attacks.
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expectedToken);
  if (tokenBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(tokenBuf, expectedBuf)) return null;

  return challenge;
};

const signaturePrefix = 'sha256=';

export const verifyMetaSignature = (payload: string, signature: string | undefined, secret: string): boolean => {
  if (!signature?.startsWith(signaturePrefix)) {
    return false;
  }

  const signatureHash = signature.slice(signaturePrefix.length);
  const expectedHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const signatureBuffer = Buffer.from(signatureHash, 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length || signatureBuffer.length === 0) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
};
