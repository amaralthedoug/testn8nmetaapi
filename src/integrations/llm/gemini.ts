import type { LLMRequest } from './types.js';
import { translateHttpError } from './utils.js';
import { LLMError } from '../../types/errors.js';

export async function callGemini(key: string, model: string, req: LLMRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ parts: [{ text: req.user }] }],
      generationConfig: { ...(req.maxTokens !== undefined && { maxOutputTokens: req.maxTokens }), temperature: req.temperature }
    })
  });
  if (!res.ok) translateHttpError(res.status);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  // BUSINESS RULE: Gemini returns empty candidates when content is blocked by safety filters.
  if (!text) throw new LLMError('Resposta bloqueada ou inesperada do Gemini. Tente outro modelo.');
  return text;
}
