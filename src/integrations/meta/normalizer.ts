import type { MetaWebhookPayload } from '../../schemas/metaWebhook.js';
import { normalizeEmail, normalizeIsoDate, normalizePhone, optionalText } from '../../utils/normalize.js';
import type { NormalizedLead } from '../../types/domain.js';

export const normalizeMetaPayload = (payload: MetaWebhookPayload): NormalizedLead[] => {
  const leads: NormalizedLead[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;

      const value = change.value;
      leads.push({
        externalLeadId: optionalText(value.leadgen_id),
        pageId: optionalText(value.page_id ?? entry.id),
        formId: optionalText(value.form_id),
        campaignId: optionalText(value.campaign_id),
        adsetId: optionalText(value.adgroup_id),
        adId: optionalText(value.ad_id),
        fullName: optionalText(value.full_name),
        firstName: optionalText(value.first_name),
        lastName: optionalText(value.last_name),
        email: normalizeEmail(value.email),
        phone: normalizePhone(value.phone_number),
        city: optionalText(value.city),
        state: optionalText(value.state),
        createdTime: normalizeIsoDate(value.created_time ? new Date(value.created_time * 1000).toISOString() : undefined),
        rawCustomFields: value.custom,
        source: 'facebook_lead_ads'
      });
    }
  }

  return leads;
};
