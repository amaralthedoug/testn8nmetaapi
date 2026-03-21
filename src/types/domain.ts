// Applies to leads.n8n_delivery_status only.
// Do NOT confuse with ProcessingStatus, which applies to webhook_events.processing_status.
export type N8nDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

export type ProcessingStatus =
  | 'received'
  | 'validated'
  | 'normalized'
  | 'persisted'
  | 'forwarded'
  | 'retrying'
  | 'failed'
  | 'duplicate';

export type ErrorCategory =
  | 'validation_error'
  | 'duplicate_event'
  | 'persistence_error'
  | 'delivery_error'
  | 'configuration_error'
  | 'unsupported_payload_error';

export type NormalizedLead = {
  externalLeadId?: string;
  pageId?: string;
  formId?: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  purchaseTimeline?: string;
  budgetRange?: string;
  productInterest?: string;
  createdTime?: string;
  rawCustomFields?: Record<string, unknown>;
  source: 'facebook_lead_ads';
};

export type N8nLeadPayload = {
  correlationId: string;
  ingestedAt: string;
  lead: NormalizedLead;
  meta: {
    isDuplicate: boolean;
    rawEventStored: boolean;
    version: string;
  };
};
