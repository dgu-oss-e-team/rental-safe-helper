// @ts-check

export const DOCUMENT_TYPE = /** @type {const} */ ({
  REGISTRY: 'REGISTRY',
  LEASE_CONTRACT: 'LEASE_CONTRACT',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Classifies a document based on text content keywords and patterns.
 * @param {string} text
 * @returns {typeof DOCUMENT_TYPE[keyof typeof DOCUMENT_TYPE]}
 */
export function detectDocumentType(text) {
  if (!text || typeof text !== 'string') {
    return DOCUMENT_TYPE.UNKNOWN;
  }

  const normalizedText = text.replace(/\s+/g, '');

  const registryKeywords = ['등기사항전부증명서', '등기부등본', '표제부', '갑구', '을구'];
  const leaseKeywords = ['주택임대차계약서', '부동산임대차계약서', '임대인', '임차인', '보증금'];

  const hasRegistryKeyword = registryKeywords.some((kw) => normalizedText.includes(kw));
  const hasLeaseKeyword = leaseKeywords.some((kw) => normalizedText.includes(kw));

  if (hasRegistryKeyword) {
    return DOCUMENT_TYPE.REGISTRY;
  }

  if (hasLeaseKeyword) {
    return DOCUMENT_TYPE.LEASE_CONTRACT;
  }

  return DOCUMENT_TYPE.UNKNOWN;
}