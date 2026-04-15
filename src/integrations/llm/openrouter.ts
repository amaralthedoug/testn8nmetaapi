import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';
import { LLMError } from '../../types/errors.js';

// BUSINESS RULE: OpenRouter uses an OpenAI-compatible API but requires HTTP-Referer
// for attribution and routes to 300+ models including free-tier ones (suffix :free).
export async function callOpenRouter(key: string, model: string, req: LLMRequest): Promise<string> {
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
  if (!res.ok) {
    // REASON: OpenRouter returns structured JSON errors with a human-readable message.
    // Extracting it avoids generic "status 404" errors that give no actionable info.
    try {
      const errBody = await res.json() as { error?: { message?: string } };
      const detail = errBody?.error?.message;
      if (detail) throw new LLMError(`OpenRouter: ${detail}`);
    } catch (parseErr) {
      if (parseErr instanceof LLMError) throw parseErr;
    }
    translateHttpError(res.status);
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LLMError('Resposta inesperada do OpenRouter.');
  return content;
}
