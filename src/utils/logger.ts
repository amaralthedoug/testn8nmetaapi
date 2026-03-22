import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: [
    'req.headers.authorization',
    'n8nAuthToken',
    'req.headers["x-api-key"]',
    'req.headers["x-internal-auth-token"]',
    'req.headers["x-hub-signature-256"]'
  ]
});
