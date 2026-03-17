import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  N8N_WEBHOOK_URL: z.string().url(),
  N8N_INTERNAL_AUTH_TOKEN: z.string().min(1),
  RETRY_MAX_ATTEMPTS: z.coerce.number().default(5),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(500),
  RETRY_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute')
});

export const env = envSchema.parse(process.env);
