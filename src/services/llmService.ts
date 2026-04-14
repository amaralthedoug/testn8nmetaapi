import { getSetting } from './settingsService.js';
import { getProvider } from '../integrations/llm/registry.js';
import { LLMError } from '../types/errors.js';
import type { LLMRequest } from '../integrations/llm/types.js';

export type { LLMRequest };

export async function askLLM(req: LLMRequest): Promise<string> {
  const [provider, key, model] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_model'),
  ]);

  if (!provider || !key || !model) {
    throw new LLMError('Configuração de IA incompleta. Acesse as configurações para configurar.');
  }

  try {
    return await getProvider(provider)(key, model, req);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new LLMError('Não foi possível conectar ao serviço de IA.');
  }
}
