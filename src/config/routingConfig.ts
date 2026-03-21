import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { z } from 'zod';

const promotableFieldSchema = z.enum([
  'phone', 'email', 'fullName', 'firstName', 'lastName',
  'city', 'state', 'productInterest', 'budgetRange', 'purchaseTimeline',
  'campaignName', 'adsetName', 'adName'
]);

const fieldMapSchema = z.record(z.string(), promotableFieldSchema);

const formEntrySchema = z.object({
  formId: z.string().min(1),
  url: z.string().url(),
  fieldMap: fieldMapSchema.optional().default({})
});

const pageEntrySchema = z.object({
  pageId: z.string().min(1),
  url: z.string().url(),
  forms: z.array(formEntrySchema).optional().default([])
});

const routingConfigSchema = z.object({
  default: z.object({ url: z.string().url() }).optional(),
  pages: z.array(pageEntrySchema).optional().default([])
});

export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export type PromotableField = z.infer<typeof promotableFieldSchema>;

const configPath = join(dirname(fileURLToPath(import.meta.url)), '../../config/routing.json');

export const loadRoutingConfig = async (): Promise<RoutingConfig | null> => {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return routingConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};
