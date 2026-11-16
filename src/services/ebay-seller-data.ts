const EBAY_SELLER_IDENTITY_KEYS = new Set([
  'seller',
  'sellerUsername',
  'sellerUserName',
  'sellerId',
  'sellerAccountId'
]);

export type EbaySellerPayloadSanitization = {
  payload: Record<string, unknown>;
  changed: boolean;
};

function sanitizeValue(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized = value.map((item) => {
      const result = sanitizeValue(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? sanitized : value, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };

  let changed = false;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (EBAY_SELLER_IDENTITY_KEYS.has(key)) {
      changed = true;
      continue;
    }
    const result = sanitizeValue(child);
    changed ||= result.changed;
    sanitized[key] = result.value;
  }
  return { value: changed ? sanitized : value, changed };
}

export function sanitizeEbayAlertPayload(payload: Record<string, unknown>): EbaySellerPayloadSanitization {
  const result = sanitizeValue(payload);
  return {
    payload: result.value as Record<string, unknown>,
    changed: result.changed
  };
}
