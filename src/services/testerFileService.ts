import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CasesFile } from './promptTesterService.js';

const PROMPTS_DIR = join(process.cwd(), 'prompts');
const CASES_DIR = join(process.cwd(), 'cases');
const RESULTS_DIR = join(process.cwd(), 'results');

export interface ResultMeta {
  file: string;
  [key: string]: unknown;
}

/**
 * SECURITY: Ensures the resolved path stays within the allowed base directory.
 * Prevents path traversal attacks (e.g. "../../.env").
 */
function guardPath(baseDir: string, name: string): string {
  const resolved = resolve(baseDir, name);
  if (!resolved.startsWith(baseDir + '/') && resolved !== baseDir) {
    throw new Error('Nome de arquivo inválido.');
  }
  return resolved;
}

export async function listPrompts(): Promise<string[]> {
  try {
    const files = await readdir(PROMPTS_DIR);
    return files.filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

export async function listCases(): Promise<string[]> {
  try {
    const files = await readdir(CASES_DIR);
    return files.filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

export async function listResults(): Promise<ResultMeta[]> {
  try {
    const files = (await readdir(RESULTS_DIR).catch(() => []))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 30);

    return Promise.all(
      files.map(async (f) => {
        const safePath = guardPath(RESULTS_DIR, f);
        const raw = await readFile(safePath, 'utf8');
        const { metadata } = JSON.parse(raw) as { metadata: Record<string, unknown> };
        return { file: f, ...metadata };
      }),
    );
  } catch {
    return [];
  }
}

export async function readPrompt(name: string): Promise<string> {
  return readFile(guardPath(PROMPTS_DIR, name), 'utf8');
}

export async function readCase(name: string): Promise<CasesFile> {
  const raw = await readFile(guardPath(CASES_DIR, name), 'utf8');
  const parsed = JSON.parse(raw) as CasesFile;
  if (!parsed.cases || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Arquivo de casos inválido: inclua um array não vazio em 'cases'.");
  }
  return parsed;
}
