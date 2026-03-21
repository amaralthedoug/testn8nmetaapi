import type { FastifyReply, FastifyRequest } from 'fastify';
import { deadLetterRepository } from '../repositories/deadLetterRepository.js';
import { N8nDeliveryService } from '../services/n8nDeliveryService.js';
import type { N8nLeadPayload } from '../types/domain.js';

export const listFailedLeads = async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as { limit?: number; offset?: number };
  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;

  const { rows, total } = await deadLetterRepository.listFailed(limit, offset);

  return reply.status(200).send({ leads: rows, total, limit, offset });
};

export const replayLead = async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id: string };

  const lead = await deadLetterRepository.findById(id);
  if (!lead) {
    return reply.status(404).send({ error: 'Lead not found' });
  }

  if (lead.n8nDeliveryStatus === 'success') {
    return reply.status(409).send({ error: 'Lead already delivered successfully' });
  }

  const claimed = await deadLetterRepository.claimForReplay(id);
  if (!claimed) {
    return reply.status(409).send({ error: 'Lead is already being replayed' });
  }

  const payload: N8nLeadPayload = {
    correlationId: `replay-${id}`,
    ingestedAt: new Date().toISOString(),
    lead: lead.normalizedPayload,
    meta: { isDuplicate: false, rawEventStored: true, version: '1.0.0' }
  };

  const service = new N8nDeliveryService();
  void service.deliver(id, payload);

  return reply.status(200).send({ replayed: true, leadId: id });
};
