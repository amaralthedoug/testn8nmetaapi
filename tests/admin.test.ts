import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/createApp.js';
import * as deadLetterRepo from '../src/repositories/deadLetterRepository.js';
import { N8nDeliveryService } from '../src/services/n8nDeliveryService.js';

const VALID_TOKEN = 'test-admin-key-at-least-32-chars!!';
const AUTH = `Bearer ${VALID_TOKEN}`;

const LEAD_ID = '00000000-0000-0000-0000-000000000001';

const LEAD_SUMMARY = {
  id: LEAD_ID,
  externalLeadId: 'ext-1',
  email: 'test@example.com',
  n8nDeliveryStatus: 'failed' as const,
  deliveryAttempts: 5,
  updatedAt: '2026-03-21T10:00:00.000Z'
};

const LEAD_DETAIL = {
  id: LEAD_ID,
  normalizedPayload: { source: 'facebook_lead_ads' as const, email: 'test@example.com' },
  n8nDeliveryStatus: 'failed' as const
};

describe('admin routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp({ enableDocs: false });
    await app.ready();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- auth ---

  it('GET /admin/leads/failed returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/leads/failed' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  it('GET /admin/leads/failed returns 401 when no Bearer prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: VALID_TOKEN }
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/leads/failed returns 401 for wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: 'Bearer wrong-token-that-is-definitely-bad!!' }
    });
    expect(res.statusCode).toBe(401);
  });

  // --- GET /admin/leads/failed ---

  it('returns 200 with empty list when no failed leads', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'listFailed').mockResolvedValue({ rows: [], total: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed',
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ leads: [], total: 0, limit: 20, offset: 0 });
  });

  it('returns 200 with leads and pagination metadata', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'listFailed').mockResolvedValue({
      rows: [LEAD_SUMMARY],
      total: 42
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/leads/failed?limit=10&offset=5',
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(42);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe(LEAD_ID);
  });

  // --- POST /admin/leads/:id/replay ---

  it('returns 400 for non-UUID :id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/leads/not-a-uuid/replay',
      headers: { authorization: AUTH }
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when lead does not exist', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_ID}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Lead not found' });
  });

  it('returns 409 when lead is already successfully delivered', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue({
      ...LEAD_DETAIL,
      n8nDeliveryStatus: 'success' as const
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_ID}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Lead already delivered successfully' });
  });

  it('returns 409 when concurrent replay wins the race (claimForReplay returns null)', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(LEAD_DETAIL);
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'claimForReplay').mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_ID}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Lead is already being replayed' });
  });

  it('returns 200, claims the lead, and fires deliver() for a failed lead', async () => {
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'findById').mockResolvedValue(LEAD_DETAIL);
    vi.spyOn(deadLetterRepo.deadLetterRepository, 'claimForReplay').mockResolvedValue(LEAD_ID);
    const deliverSpy = vi.spyOn(N8nDeliveryService.prototype, 'deliver').mockResolvedValue();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/leads/${LEAD_ID}/replay`,
      headers: { authorization: AUTH }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replayed: true, leadId: LEAD_ID });
    // deliver() is fire-and-forget — give the event loop one tick to confirm it was called
    await new Promise((resolve) => setImmediate(resolve));
    expect(deliverSpy).toHaveBeenCalledOnce();
  });
});
