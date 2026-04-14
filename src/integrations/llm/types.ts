export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}
