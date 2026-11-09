// @ts-check
import { ok, fail, ERROR_CODE, DOCUMENT_TYPE } from '../../shared/document-model.js';
import { readPdfText } from './pdf-reader.js';
import { recognizeImageText } from './ocr.js';
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
 * Normalizes raw text into document pages and blocks matching the exact DocumentModel schema.
 * @param {string[]} textPages
 * @returns {import('../../shared/document-model.js').Page[]}
 */
export function normalizePagesAndBlocks(textPages) {
  if (!Array.isArray(textPages) || textPages.length === 0) {
    return [
      {
        pageIndex: 0,
        width: 1000,
        height: 1414,
        blocks: [
          {
            blockId: 'block-0-0',
            text: '',
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            confidence: null
          }
        ]
      }
    ];
  }

  return textPages.map((pageText, pageIdx) => {
    const lines = pageText.split('\n').filter((l) => l.trim().length > 0);
    const blocks = lines.length > 0
      ? lines.map((line, lineIdx) => ({
          blockId: `block-${pageIdx}-${lineIdx}`,
          text: line,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          confidence: null
        }))
      : [
          {
            blockId: `block-${pageIdx}-0`,
            text: pageText || '',
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            confidence: null
          }
        ];

    return {
      pageIndex: pageIdx,
      width: 1000,
      height: 1414,
      blocks
    };
  });
}

/**
 * Public Entry Point: Processes uploaded lease or registry documents.
 * Extracts text via PDF parser or OCR engine and returns a normalized DocumentModel.
 * @param {File} file
 * @returns {Promise<import('../../shared/document-model.js').Result<import('../../shared/document-model.js').DocumentModel>>}
 */
export async function readDocument(file) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Unsupported file format');
  }

  try {
    const buffer = await file.arrayBuffer();
    const fileName = file.name || '';
    const isPdf = fileName.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    let textPages = [];

    if (isPdf) {
      const pdfRes = await readPdfText(buffer);
      textPages = pdfRes.textPages || [];
    } else {
      const ocrRes = await recognizeImageText(buffer);
      textPages = [ocrRes.text || ''];
    }

    const isRegistry = /registry|register|등기/i.test(fileName);
    /** @type {import('../../shared/document-model.js').DocumentModel} */
    const fallbackMock = isRegistry ? mockRegistryDocument : mockLeaseDocument;

    const normalizedPages = normalizePagesAndBlocks(textPages);

    /** @type {import('../../shared/document-model.js').DocumentModel} */
    const documentModel = {
      documentId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      documentType: isRegistry ? DOCUMENT_TYPE.REGISTRY : DOCUMENT_TYPE.LEASE_CONTRACT,
      sourceType: isPdf ? 'pdf' : 'image',
      pages: normalizedPages.length > 0 ? normalizedPages : fallbackMock.pages
    };

    return ok(documentModel);
  } catch (error) {
    return fail(ERROR_CODE.PDF_READ_FAILED, 'Failed to process document fields');
  }
}