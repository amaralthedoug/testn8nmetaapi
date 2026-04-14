import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';

export async function callAnthropic(key: string, model: string, req: LLMRequest): Promise<string> {
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
