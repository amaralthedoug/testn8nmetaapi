import { z } from 'zod';

const changeSchema = z.object({
  field: z.string(),
  value: z.object({
    leadgen_id: z.string().optional(),
    page_id: z.string().optional(),
    form_id: z.string().optional(),
    ad_id: z.string().optional(),
    adgroup_id: z.string().optional(),
    created_time: z.number().optional(),
    campaign_id: z.string().optional(),
    custom: z.record(z.unknown()).optional(),
    email: z.string().optional(),
    phone_number: z.string().optional(),
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional()
  }).passthrough()
});

export const metaWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(changeSchema).default([])
    })
  )
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookSchema>;
