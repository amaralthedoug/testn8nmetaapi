import { askLLM } from './llmService.js';
import { callAnthropic } from '../integrations/llm/anthropic.js';

export interface CaseItem {
  id: string;
  input: string;
  expected?: string;
}

export interface CasesFile {
  client: string;
  niche: string;
  cases: CaseItem[];
}

export interface CaseResult {
  id: string;
  input: string;
  output: string;
  expected?: string;
  pass: boolean;
  notes: string;
}

const STOPWORDS = new Set([
  'a', 'as', 'o', 'os', 'e', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas',
  'para', 'por', 'com', 'sem',
]);

function tokenizeWords(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function buildMockResponse(input: string): string {
  const lowered = input.toLowerCase();
  if (lowered.includes('preço') || lowered.includes('valor')) {
    return 'Posso te passar uma faixa inicial, mas antes quero entender seu objetivo para indicar a melhor opção. Você busca começar ainda este mês?';
  }
  if (lowered.includes('dor') || lowered.includes('medo')) {
    return 'Super normal ter essa dúvida. A avaliação é justamente para te orientar com segurança no seu caso. Quer que eu te explique como funciona?';
  }
  return 'Perfeito! Me conta seu objetivo principal com esse procedimento para eu te orientar da forma mais assertiva.';
}

export async function askAnthropic(
  apiKey: string | undefined,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  if (apiKey) {
    return callAnthropic(apiKey, model, {
      system: systemPrompt,
      user: userMessage,
      maxTokens,
      temperature,
    });
  }
  return askLLM({ system: systemPrompt, user: userMessage, maxTokens, temperature });
}

function evaluateCase(item: CaseItem, output: string): { pass: boolean; notes: string } {
  if (!item.expected) return { pass: true, notes: 'Sem critério esperado explícito.' };

  const expectedTokens = tokenizeWords(item.expected)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .slice(0, 8);

  const outputWords = new Set(tokenizeWords(output));
  const matchedTokens = expectedTokens.filter((token) => outputWords.has(token));

  if (expectedTokens.length === 0)
    return { pass: true, notes: 'Sem tokens relevantes após normalização.' };

  const ratio = matchedTokens.length / expectedTokens.length;

  if (ratio >= 0.5) {
    return {
      pass: true,
      notes: `Cobertura: ${(ratio * 100).toFixed(0)}% (${matchedTokens.length}/${expectedTokens.length} tokens)`,
    };
  }

  return {
    pass: false,
    notes: `Baixa cobertura (${(ratio * 100).toFixed(0)}%). Esperado: ${expectedTokens.join(', ')}`,
  };
}

export async function runTests(options: {
  promptContent: string;
  casesFile: CasesFile;
  mock: boolean;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<CaseResult[]> {
  const {
    promptContent,
    casesFile,
    mock,
    apiKey,
    model = 'claude-haiku-4-5-20251001',
    maxTokens = 220,
    temperature = 0.3,
  } = options;

  const results: CaseResult[] = [];

  for (const item of casesFile.cases) {
    const output = mock
      ? buildMockResponse(item.input)
      : await askAnthropic(apiKey as string, model, promptContent, item.input, maxTokens, temperature);

    const verdict = evaluateCase(item, output);
    results.push({ id: item.id, input: item.input, output, expected: item.expected, ...verdict });
  }

  return results;
}
