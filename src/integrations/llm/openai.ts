import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';
import { LLMError } from '../../types/errors.js';

export async function callOpenAI(key: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      ...(req.maxTokens !== undefined && { max_tokens: req.maxTokens }),
      temperature: req.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ]
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LLMError('Resposta inesperada da OpenAI.');
  return content;
}
