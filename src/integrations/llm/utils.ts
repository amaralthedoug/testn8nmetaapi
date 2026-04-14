import { LLMError } from '../../types/errors.js';

export function translateHttpError(status: number): never {
  if (status === 401) throw new LLMError('Chave de API inválida. Verifique e tente novamente.');
  if (status === 429) throw new LLMError('Limite de uso atingido. Aguarde alguns instantes.');
  throw new LLMError(`Erro ao chamar a IA (status ${status}).`);
}
