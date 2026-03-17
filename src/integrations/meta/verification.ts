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
