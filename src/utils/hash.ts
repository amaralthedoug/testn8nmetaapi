import { createHash } from 'node:crypto';
import type { NormalizedLead } from '../types/domain.js';

export const buildLeadHash = (lead: NormalizedLead): string => {
  if (lead.externalLeadId) {
    // BUSINESS RULE: Include source in the hash prefix to prevent dedup collisions
    // between different systems that may generate the same handle/external ID.
    return `external:${lead.source ?? 'unknown'}:${lead.externalLeadId}`;
  }

  const key = [lead.phone, lead.email, lead.formId, lead.createdTime].map((x) => x ?? '').join('|');
  return createHash('sha256').update(key).digest('hex');
};
