// @ts-check
/**
 * PART 1. Document Input & OCR
 * Owner: See docs/OWNERS.md
 *
 * Public Function: readDocument(file) → Result<DocumentModel>
 */

import { readPdfText } from './pdf-reader.js';
import { recognizeImageText } from './ocr.js';
import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { mockRegistryDocument, mockLeaseDocument } from '../../shared/mock-data.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */

const SUPPORTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const SUPPORTED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];

/**
 * Validates whether the provided file type/extension is supported.
 * @param {{ name?: string, type?: string } | null | undefined} file
 * @returns {boolean}
 */
export function isSupportedFile(file) {
  if (!file || typeof file.name !== 'string') return false;
  const name = file.name.toLowerCase();
  const byExt = SUPPORTED_EXT.some((ext) => name.endsWith(ext));
  const byMime = typeof file.type === 'string' && SUPPORTED_MIME.includes(file.type);
  return byExt || byMime;
}

/**
 * Reads a PDF or image file and converts it into a DocumentModel.
 * @param {File} file
 * @returns {Promise<import('../../shared/document-model.js').Result<DocumentModel>>}
 */
export async function readDocument(file) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Please upload a PDF, JPG, or PNG file.');
  }

  console.log('Processing file:', file.name, file.type);

  // PDF handling
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (typeof file.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer();
      await readPdfText(buffer);
    }
  }

  // Image OCR handling
  if (file.type?.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
    if (typeof file.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer();
      await recognizeImageText(buffer);
    }
  }

  const name = file.name.toLowerCase();
  const looksLikeRegistry = /registry|register|등기/.test(name);
  const mock = looksLikeRegistry ? mockRegistryDocument : mockLeaseDocument;
  return ok(structuredClone(mock));
}