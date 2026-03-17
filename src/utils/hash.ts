import { createHash } from 'node:crypto';
import type { NormalizedLead } from '../types/domain.js';

export const buildLeadHash = (lead: NormalizedLead): string => {
  if (lead.externalLeadId) {
    return `external:${lead.externalLeadId}`;
  }

  const key = [lead.phone, lead.email, lead.formId, lead.createdTime].map((x) => x ?? '').join('|');
  return createHash('sha256').update(key).digest('hex');
};
