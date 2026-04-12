import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/settingsService.js', () => ({
  getSetting: vi.fn()
}));

import { getSetting } from '../src/services/settingsService.js';
import { askLLM } from '../src/services/llmService.js';

const mockGetSetting = vi.mocked(getSetting);

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

beforeEach(() => vi.clearAllMocks());

describe('askLLM — Anthropic', () => {
  it('calls Anthropic API with correct headers and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')         // llm_provider
      .mockResolvedValueOnce('sk-ant-test')       // llm_api_key
      .mockResolvedValueOnce('claude-haiku-4-5'); // llm_model

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: 'Hello' }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hello');

    const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
  });

  it('translates HTTP 401 to user-friendly message', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')
      .mockResolvedValueOnce('bad-key')
      .mockResolvedValueOnce('claude-haiku-4-5');

    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(
      askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 })
    ).rejects.toThrow('Chave de API inválida');
  });

  it('translates HTTP 429 to user-friendly message', async () => {
    mockGetSetting
      .mockResolvedValueOnce('anthropic')
      .mockResolvedValueOnce('sk-ant-test')
      .mockResolvedValueOnce('claude-haiku-4-5');

    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 } as Response);

    await expect(
      askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 })
    ).rejects.toThrow('Limite de uso atingido');
  });
});

describe('askLLM — OpenAI', () => {
  it('calls OpenAI API and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('openai')
      .mockResolvedValueOnce('sk-test')
      .mockResolvedValueOnce('gpt-4o-mini');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hi from GPT' } }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hi from GPT');
  });
});

describe('askLLM — Gemini', () => {
  it('calls Gemini API and returns text', async () => {
    mockGetSetting
      .mockResolvedValueOnce('gemini')
      .mockResolvedValueOnce('ai-test-key')
      .mockResolvedValueOnce('gemini-2.0-flash');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hi from Gemini' }] } }] })
    } as Response);

    const result = await askLLM({ system: 'sys', user: 'hi', maxTokens: 100, temperature: 0.5 });
    expect(result).toBe('Hi from Gemini');
  });
});
