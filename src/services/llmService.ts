import { getSetting } from './settingsService.js';

export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

function translateHttpError(status: number): never {
  if (status === 401) throw new Error('Chave de API inválida. Verifique e tente novamente.');
  if (status === 429) throw new Error('Limite de uso atingido. Aguarde alguns instantes.');
  throw new Error(`Erro ao chamar a IA (status ${status}).`);
}

async function callAnthropic(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system: req.system,
      messages: [{ role: 'user', content: req.user }]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0].text;
}

async function callOpenAI(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

async function callGemini(key: string, model: string, req: LLMRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ parts: [{ text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature }
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return data.candidates[0].content.parts[0].text;
}

// BUSINESS RULE: OpenRouter uses an OpenAI-compatible API but requires HTTP-Referer
// for attribution and routes to 300+ models including free-tier ones (suffix :free).
async function callOpenRouter(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://testn8nmetaapi.onrender.com',
      'X-Title': 'SDR AI'
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

export async function askLLM(req: LLMRequest): Promise<string> {
  const [provider, key, model] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_model')
  ]);

  if (!provider || !key || !model) {
    throw new Error('Configuração de IA incompleta. Acesse as configurações para configurar.');
  }

  try {
    if (provider === 'anthropic') return await callAnthropic(key, model, req);
    if (provider === 'openai') return await callOpenAI(key, model, req);
    if (provider === 'gemini') return await callGemini(key, model, req);
    if (provider === 'openrouter') return await callOpenRouter(key, model, req);
    throw new Error(`Provedor desconhecido: ${provider}`);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Não foi possível conectar ao serviço de IA.');
  }
}
