export const normalizeEmail = (email?: string): string | undefined => {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

export const normalizePhone = (phone?: string): string | undefined => {
  if (!phone) return undefined;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized.length > 0 ? normalized : undefined;
};

export const optionalText = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeIsoDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
};
