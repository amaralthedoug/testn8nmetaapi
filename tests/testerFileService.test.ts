import { describe, it, expect } from 'vitest';
import { readPrompt, readCase } from '../src/services/testerFileService.js';

describe('testerFileService — path traversal guard', () => {
  it('rejects readPrompt with path traversal', async () => {
    await expect(readPrompt('../../../etc/passwd')).rejects.toThrow('Nome de arquivo inválido.');
  });

  it('rejects readPrompt with absolute path', async () => {
    await expect(readPrompt('/etc/passwd')).rejects.toThrow('Nome de arquivo inválido.');
  });

  it('rejects readCase with path traversal', async () => {
    await expect(readCase('../../.env')).rejects.toThrow('Nome de arquivo inválido.');
  });

  it('rejects readCase with nested traversal', async () => {
    await expect(readCase('subdir/../../../secret.json')).rejects.toThrow('Nome de arquivo inválido.');
  });
});
