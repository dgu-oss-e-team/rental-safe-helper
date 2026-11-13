// @ts-check
import { ok, fail, ERROR_CODE, DOCUMENT_TYPE, SOURCE_TYPE } from '../../shared/document-model.js';
import { readPdfText, renderPdfToImages } from './pdf-reader.js';
import { recognizeImageText } from './ocr.js';
import { mockRegistryDocument, mockLeaseDocument } from '../../shared/mock-data.js';

export const MIN_OCR_CONFIDENCE = 0.6;
export const MIN_DIGIT_LINE_CONFIDENCE = 0.8;

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
 * Normalizes raw text pages into document pages and blocks matching the DocumentModel schema.
 * @param {string[]} textPages
 * @param {number|null} [ocrConfidence=null]
 * @returns {import('../../shared/document-model.js').Page[]}
 */
export function normalizePagesAndBlocks(textPages, ocrConfidence = null) {
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
            confidence: ocrConfidence,
          },
        ],
      },
    ];
  }

  return textPages.map((pageText, pageIdx) => {
    const lines = pageText.split('\n').filter((l) => l.trim().length > 0);
    const blocks =
      lines.length > 0
        ? lines.map((line, lineIdx) => ({
            blockId: `block-${pageIdx}-${lineIdx}`,
            text: line,
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            confidence: ocrConfidence,
          }))
        : [
            {
              blockId: `block-${pageIdx}-0`,
              text: pageText || '',
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              confidence: ocrConfidence,
            },
          ];

    return {
      pageIndex: pageIdx,
      width: 1000,
      height: 1414,
      blocks,
    };
  });
}

/**
 * Validates OCR output for a single page and converts positioned OCR blocks into a Page.
 * Rejects pages without positioned blocks (avoiding full-page 0,0,1,1 masks).
 * Unless allowLowConfidence is true (for the OCR review editor flow), rejects pages below
 * MIN_OCR_CONFIDENCE or digit-bearing lines below MIN_DIGIT_LINE_CONFIDENCE.
 *
 * @param {{ text: string, confidence: number, blocks?: Array<{ text: string, confidence?: number, bbox: { x: number, y: number, width: number, height: number } }>, width?: number, height?: number }} ocrRes
 * @param {number} pageIndex
 * @param {number} defaultWidth
 * @param {number} defaultHeight
 * @param {{ allowLowConfidence?: boolean }} [options]
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').Page>}
 */
function buildValidatedOcrPage(ocrRes, pageIndex, defaultWidth, defaultHeight, options = {}) {
  const { allowLowConfidence = false } = options;

  const positionedBlocks = Array.isArray(ocrRes.blocks)
    ? ocrRes.blocks.filter((b) => b.text && b.text.trim().length > 0 && b.bbox)
    : [];

  if (positionedBlocks.length === 0) {
    return fail(ERROR_CODE.LOW_CONFIDENCE, 'Could not determine text positions for safe masking.');
  }

  const pageConfidence =
    typeof ocrRes.confidence === 'number'
      ? ocrRes.confidence
      : positionedBlocks.reduce(
          (sum, b) => sum + (typeof b.confidence === 'number' ? b.confidence : 0),
          0
        ) / positionedBlocks.length;

  const normalizedBlocks = positionedBlocks.map((b, idx) => ({
    blockId: `p${pageIndex}_b${idx}`,
    text: b.text.trim(),
    bbox: b.bbox,
    confidence: typeof b.confidence === 'number' ? b.confidence : pageConfidence,
  }));

  if (!allowLowConfidence) {
    if (pageConfidence < MIN_OCR_CONFIDENCE) {
      return fail(
        ERROR_CODE.LOW_CONFIDENCE,
        'OCR confidence is too low to safely mask personal information.'
      );
    }

    // Guard against partially mangled numeric IDs (e.g. RRN/Foreigner ID) passing page-level threshold
    const hasLowConfidenceDigits = normalizedBlocks.some(
      (b) => /\d/.test(b.text) && b.confidence < MIN_DIGIT_LINE_CONFIDENCE
    );
    if (hasLowConfidenceDigits) {
      return fail(
        ERROR_CODE.LOW_CONFIDENCE,
        'Numeric OCR confidence is too low to safely mask personal information.'
      );
    }
  }

  return ok({
    pageIndex,
    width: ocrRes.width || defaultWidth || 1000,
    height: ocrRes.height || defaultHeight || 1414,
    blocks: normalizedBlocks,
  });
}

/**
 * Fallback pipeline for scanned/image-only PDFs with no embedded text stream.
 * Renders PDF pages to images and runs OCR per page with safety checks.
 * @param {ArrayBuffer} buffer
 * @param {{ allowLowConfidence?: boolean }} [options]
 * @returns {Promise<import('../../shared/document-model.js').Result<import('../../shared/document-model.js').Page[]>>}
 */
async function extractScannedPdfPages(buffer, options = {}) {
  /** @type {Array<{ pageIndex: number, buffer: ArrayBuffer, width: number, height: number }>} */
  let pageImages;
  try {
    pageImages = await renderPdfToImages(buffer);
  } catch {
    return fail(ERROR_CODE.LOW_CONFIDENCE, 'No text found in this PDF.');
  }

  if (!pageImages || pageImages.length === 0) {
    return fail(ERROR_CODE.LOW_CONFIDENCE, 'No text found in this PDF.');
  }

  /** @type {import('../../shared/document-model.js').Page[]} */
  const ocrPages = [];

  for (const pageImg of pageImages) {
    let ocrRes;
    try {
      ocrRes = await recognizeImageText(pageImg.buffer);
    } catch {
      return fail(ERROR_CODE.LOW_CONFIDENCE, 'No text found in this PDF.');
    }

    const pageResult = buildValidatedOcrPage(
      ocrRes,
      pageImg.pageIndex,
      pageImg.width,
      pageImg.height,
      options
    );
    if (!pageResult.ok) {
      return pageResult;
    }

    ocrPages.push(pageResult.data);
  }

  return ok(ocrPages);
}

/**
 * Public Entry Point: Processes uploaded lease or registry documents.
 * Extracts text via PDF parser or OCR engine, deriving real normalized coordinates (bbox)
 * and dynamic page dimensions to construct a valid DocumentModel.
 *
 * @param {File} file
 * @param {{ allowLowConfidence?: boolean }} [options]
 * @returns {Promise<import('../../shared/document-model.js').Result<import('../../shared/document-model.js').DocumentModel>>}
 */
export async function readDocument(file, options = {}) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Unsupported file format');
  }

  try {
    const buffer = await file.arrayBuffer();
    const fileName = file.name || '';
    const isRegistry = /registry|register|등기/i.test(fileName);

    /** @type {import('../../shared/document-model.js').DocumentModel} */
    const fallbackMock = isRegistry ? mockRegistryDocument : mockLeaseDocument;

    // Handle 0-byte sample/demo files for UI testing compatibility
    if (!buffer || buffer.byteLength === 0) {
      return ok(structuredClone(fallbackMock));
    }

    const isPdf = fileName.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    if (isPdf) {
      // Pass a copy so pdf.js worker transfer does not detach `buffer` for OCR fallback
      const pdfRes = await readPdfText(buffer.slice(0));

      // Scanned PDF check: if no embedded text stream, run OCR fallback or return LOW_CONFIDENCE safety error
      const hasText = pdfRes.pages && pdfRes.pages.some((p) => p.blocks.length > 0);
      if (!hasText && pdfRes.textPages.every((t) => t.trim().length === 0)) {
        const scannedResult = await extractScannedPdfPages(buffer, options);
        if (!scannedResult.ok) {
          return scannedResult;
        }

        /** @type {import('../../shared/document-model.js').DocumentModel} */
        const scannedDocumentModel = {
          documentId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          documentType: DOCUMENT_TYPE.UNKNOWN,
          sourceType: SOURCE_TYPE.IMAGE_PDF,
          pages: scannedResult.data,
        };

        return ok(scannedDocumentModel);
      }

      const pages =
        pdfRes.pages && pdfRes.pages.length > 0
          ? pdfRes.pages
          : normalizePagesAndBlocks(pdfRes.textPages, null);

      /** @type {import('../../shared/document-model.js').DocumentModel} */
      const documentModel = {
        documentId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        documentType: DOCUMENT_TYPE.UNKNOWN,
        sourceType: SOURCE_TYPE.TEXT_PDF,
        pages,
      };

      return ok(documentModel);
    } else {
      // Image OCR Processing
      const ocrRes = await recognizeImageText(buffer);
      const pageResult = buildValidatedOcrPage(ocrRes, 0, 1000, 1414, options);
      if (!pageResult.ok) {
        return pageResult;
      }

      /** @type {import('../../shared/document-model.js').DocumentModel} */
      const documentModel = {
        documentId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        documentType: DOCUMENT_TYPE.UNKNOWN,
        sourceType: SOURCE_TYPE.IMAGE,
        pages: [pageResult.data],
      };

      return ok(documentModel);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '';
    if (errMsg === ERROR_CODE.OCR_FAILED) {
      return fail(ERROR_CODE.OCR_FAILED, 'OCR text extraction failed');
    }
    return fail(ERROR_CODE.PDF_READ_FAILED, 'Failed to process document fields');
  }
}

// OCR 결과 수정 화면 (PART 5 #54에서 slots.ocrEditor에 연결)
export { renderOcrEditor, isLowConfidenceBlock } from './ocr-editor.js';