import type { NormalizedLead } from '../types/domain.js';
import type { PromotableField } from '../config/routingConfig.js';

export const applyFieldMap = (
  lead: NormalizedLead,
  fieldMap: Record<string, PromotableField>
): NormalizedLead => {
  if (Object.keys(fieldMap).length === 0) return lead;

  const customFields = { ...(lead.rawCustomFields ?? {}) };
  const overrides: Partial<NormalizedLead> = {};

  for (const [sourceKey, targetField] of Object.entries(fieldMap)) {
    const value = customFields[sourceKey];
    if (typeof value !== 'string') continue;
    if (lead[targetField] !== undefined) continue;

    overrides[targetField] = value as never;
    delete customFields[sourceKey];
  }

  return { ...lead, ...overrides, rawCustomFields: customFields };
};
