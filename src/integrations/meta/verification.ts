import crypto from 'crypto';

export const verifyMetaChallenge = (
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
  expectedToken: string
): string | null => {
  if (mode === 'subscribe' && token === expectedToken && challenge) {
    return challenge;
  }
  return null;
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
