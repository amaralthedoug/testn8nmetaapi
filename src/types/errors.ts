export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class LLMError extends AppError {
  constructor(msg: string) { super(msg, 502, 'LLM_ERROR'); }
}

export class AuthError extends AppError {
  constructor(msg: string) { super(msg, 401, 'AUTH_ERROR'); }
}

export class IngestionError extends AppError {
  constructor(msg: string) { super(msg, 422, 'INGESTION_ERROR'); }
}

export class ConfigError extends AppError {
  constructor(msg: string) { super(msg, 503, 'CONFIG_ERROR'); }
}
