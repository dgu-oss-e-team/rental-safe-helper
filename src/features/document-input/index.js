// @ts-check
import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { mockRegistryDocument, mockLeaseDocument } from '../../shared/mock-data.js';

/**
 * Validates if the file format is supported (.pdf, .jpg, .jpeg, .png)
 * by checking both extension and MIME type.
 * @param {File} file
 * @returns {boolean}
 */
export function isSupportedFile(file) {
  if (!file) return false;

  const validExts = ['pdf', 'jpg', 'jpeg', 'png'];
  const validMimes = ['application/pdf', 'image/jpeg', 'image/png'];

  const fileName = file.name || '';
  const ext = fileName.split('.').pop()?.toLowerCase();

  const isExtValid = Boolean(ext && validExts.includes(ext));
  const isMimeValid = Boolean(file.type && validMimes.includes(file.type));

  return isExtValid || isMimeValid;
}

/**
 * Public Entry Point: Processes uploaded lease or registry documents.
 * TODO(PART 1): Connect full PDF/OCR block parsing for PART 2 integration.
 * @param {File} file
 * @returns {Promise<import('../../shared/document-model.js').Result<import('../../shared/document-model.js').DocumentModel>>}
 */
export async function readDocument(file) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Unsupported file format');
  }

  const isRegistry = /registry|register|등기/i.test(file.name);
  const targetMock = isRegistry ? mockRegistryDocument : mockLeaseDocument;

  return ok(structuredClone(targetMock));
}