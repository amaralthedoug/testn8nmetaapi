import type { RoutingConfig, PromotableField } from './config.js';

export type RouteMatch = {
  url: string;
  fieldMap: Record<string, PromotableField>;
  source: 'form' | 'page' | 'default' | 'env';
};

export const resolveRoute = (
  formId: string | undefined,
  pageId: string | undefined,
  config: RoutingConfig | null,
  envFallbackUrl: string
): RouteMatch => {
  if (config) {
    for (const page of config.pages ?? []) {
      for (const form of page.forms ?? []) {
        if (form.formId === formId) {
          return { url: form.url, fieldMap: form.fieldMap ?? {}, source: 'form' };
        }
      }
    }

    for (const page of config.pages ?? []) {
      if (page.pageId === pageId) {
        return { url: page.url, fieldMap: {}, source: 'page' };
      }
    }

    if (config.default) {
      return { url: config.default.url, fieldMap: {}, source: 'default' };
    }
  }

  return { url: envFallbackUrl, fieldMap: {}, source: 'env' };
};
