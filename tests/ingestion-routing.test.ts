import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp.js';
import * as n8nClient from '../src/integrations/n8n/client.js';
import { webhookEventRepository } from '../src/repositories/webhookEventRepository.js';
import { leadRepository } from '../src/repositories/leadRepository.js';
import { deliveryAttemptRepository } from '../src/repositories/deliveryAttemptRepository.js';
import { LeadIngestionService } from '../src/services/leadIngestionService.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';
import type { RoutingConfig } from '../src/config/routingConfig.js';

const APP_SECRET = 'test-app-secret';
const FORM_URL = 'https://form-specific.example.com/webhook';

function makeSignature(body: string) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

const routingConfig: RoutingConfig = {
  pages: [{
    pageId: 'page-1',
    url: 'https://page.example.com/webhook',
    forms: [{ formId: 'form-1', url: FORM_URL, fieldMap: {} }]
  }]
};

describe('ingestion route with routing config', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });

    // Override the decorated service with one that has routing config
    (app as never as { leadIngestionService: LeadIngestionService }).leadIngestionService =
      new LeadIngestionService(new N8nDeliveryService(), routingConfig);

    await app.ready();

    vi.spyOn(webhookEventRepository, 'create').mockResolvedValue('event-id');
    vi.spyOn(webhookEventRepository, 'updateStatus').mockResolvedValue();
    vi.spyOn(leadRepository, 'findByHash').mockResolvedValue(null);
    vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id');
    vi.spyOn(leadRepository, 'incrementAttempts').mockResolvedValue();
    vi.spyOn(leadRepository, 'markForwardStatus').mockResolvedValue();
    vi.spyOn(deliveryAttemptRepository, 'create').mockResolvedValue();
  });

  afterEach(async () => {
    // Wait for any fire-and-forget setImmediate callbacks to drain before restoring mocks
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();
    vi.restoreAllMocks();
  });

  it('delivers to form-specific URL when formId matches routing config', async () => {
    const postSpy = vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({
      ok: true, status: 200, body: 'ok'
    });

    const body = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'page-1',
        changes: [{ field: 'leadgen', value: { form_id: 'form-1', leadgen_id: 'ext-1' } }]
      }]
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': makeSignature(body)
      },
      body
    });

    expect(res.statusCode).toBe(202);

    // deliver() is fire-and-forget — wait one tick
    await new Promise((resolve) => setImmediate(resolve));
    expect(postSpy).toHaveBeenCalledWith(expect.anything(), FORM_URL);
  });

  it('persists the resolved URL to leadRepository.create', async () => {
    vi.spyOn(n8nClient, 'postToN8n').mockResolvedValue({ ok: true, status: 200, body: 'ok' });
    const createSpy = vi.spyOn(leadRepository, 'create').mockResolvedValue('lead-id');

    const body = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'page-1',
        changes: [{ field: 'leadgen', value: { form_id: 'form-1', leadgen_id: 'ext-2' } }]
      }]
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/meta/lead-ads',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': makeSignature(body)
      },
      body
    });

    expect(createSpy).toHaveBeenCalledWith(expect.anything(), expect.any(String), FORM_URL);
  });
});
