import { randomUUID } from 'node:crypto';

export const correlationIdFromHeader = (headerValue?: string): string => headerValue ?? randomUUID();
