import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

if (process.env.NODE_ENV === 'test') {
  process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/test';
  process.env.META_VERIFY_TOKEN ??= 'test-verify-token';
  process.env.META_APP_SECRET ??= 'test-app-secret';
  process.env.N8N_WEBHOOK_URL ??= 'https://example.com/webhook';
  process.env.N8N_INTERNAL_AUTH_TOKEN ??= 'test-n8n-token';
  process.env.BACKEND_API_KEY ??= 'test-api-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret-exactly-32-chars-x';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  META_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().url(),
  N8N_INTERNAL_AUTH_TOKEN: z.string().min(1),
  RETRY_MAX_ATTEMPTS: z.coerce.number().default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(500),
  RETRY_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  BACKEND_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  JWT_SECRET: z.string().min(32).default('dev-jwt-secret-change-in-production-32ch').refine(
    (val) => process.env.NODE_ENV !== 'production' || val !== 'dev-jwt-secret-change-in-production-32ch',
    { message: 'JWT_SECRET must be changed from the default value in production' }
  )
});

export const env = envSchema.parse(process.env);
