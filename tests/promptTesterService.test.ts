import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/llmService.js', () => ({
  askLLM: vi.fn()
}));

import { askLLM } from '../src/services/llmService.js';
import { askAnthropic } from '../src/services/promptTesterService.js';

const mockAskLLM = vi.mocked(askLLM);

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

beforeEach(() => vi.clearAllMocks());

describe('askAnthropic', () => {
  it('calls Anthropic directly when apiKey is provided — does NOT delegate to askLLM', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: 'direct response' }] })
    } as Response);

    const result = await askAnthropic('sk-ant-real', 'claude-haiku-4-5-20251001', 'sys', 'user', 100, 0.3);

    expect(result).toBe('direct response');
    expect(mockAskLLM).not.toHaveBeenCalled();
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('falls back to askLLM when apiKey is undefined', async () => {
    mockAskLLM.mockResolvedValueOnce('llm response');

    const result = await askAnthropic(undefined as unknown as string, 'any-model', 'sys', 'user', 100, 0.3);

    expect(result).toBe('llm response');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
