// @ts-check
import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { mockRegistryDocument } from '../../shared/mock-data.js';

/**
 * Validates if the file format is supported (.pdf, .jpg, .jpeg, .png).
 * @param {File} file
 * @returns {boolean}
 */
export function isSupportedFile(file) {
  if (!file || !file.name) return false;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['pdf', 'jpg', 'jpeg', 'png'].includes(ext || '');
}

/**
 * Public Entry Point: Processes uploaded lease or registry documents.
 * @param {File} file
 * @returns {Promise<import('../../shared/document-model.js').Result<import('../../shared/document-model.js').DocumentModel>>}
 */
export async function readDocument(file) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Unsupported file format');
  }

  // NOTE: PDF/OCR extraction calls are intentionally omitted here until PART 2
  // block mapping integration to prevent unnecessary execution overhead.
  return ok(mockRegistryDocument);
}