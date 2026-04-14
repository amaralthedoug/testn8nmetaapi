import { callAnthropic } from './anthropic.js';
import { callOpenAI } from './openai.js';
import { callGemini } from './gemini.js';
import { callOpenRouter } from './openrouter.js';
import { LLMError } from '../../types/errors.js';
import type { LLMRequest } from './types.js';

type ProviderFn = (key: string, model: string, req: LLMRequest) => Promise<string>;

const providers: Record<string, ProviderFn> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  openrouter: callOpenRouter,
};

export function getProvider(name: string): ProviderFn {
  const fn = providers[name];
  if (!fn) throw new LLMError(`Provedor desconhecido: ${name}`);
  return fn;
}
