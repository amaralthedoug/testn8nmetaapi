import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../src/services/authService.js';

describe('hashPassword', () => {
  it('returns a bcrypt hash', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('throws when password is shorter than 8 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow('mínimo 8 caracteres');
  });

  it('produces different hashes for same input (salt)', async () => {
    const h1 = await hashPassword('mypassword');
    const h2 = await hashPassword('mypassword');
    expect(h1).not.toBe(h2);
  });
});

describe('comparePassword', () => {
  it('returns true for matching password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await comparePassword('correct-password', hash)).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await comparePassword('wrong-password', hash)).toBe(false);
  });
});
