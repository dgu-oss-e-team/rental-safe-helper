// @ts-check
import { createWorker, PSM } from 'tesseract.js';
import { ERROR_CODE } from '../../shared/document-model.js';

/** @type {any} */
let cachedWorker = null;

/**
 * Helper to get or create a shared Tesseract worker instance.
 */
async function getWorker() {
  if (!cachedWorker) {
    // Default CDN paths (no local public assets required)
    cachedWorker = await createWorker('kor+eng', 1);
  }
  return cachedWorker;
}

/**
 * Extracts normalized line blocks from a Tesseract recognize() result.
 * @param {any} data
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} fallbackConfidence
 */
function extractNormalizedLines(data, imageWidth, imageHeight, fallbackConfidence) {
  /** @type {any[]} */
  const rawLines = [];
  if (data?.blocks && Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      if (block.paragraphs && Array.isArray(block.paragraphs)) {
        for (const para of block.paragraphs) {
          if (para.lines && Array.isArray(para.lines)) {
            rawLines.push(...para.lines);
          }
        }
      }
    }
  }

  return rawLines
    .map((line) => {
      const { x0, y0, x1, y1 } = line.bbox;
      const lineText = line.text ? line.text.trim() : '';
      const lineConfidence =
        typeof line.confidence === 'number'
          ? Number((line.confidence / 100).toFixed(4))
          : fallbackConfidence;

      return {
        text: lineText,
        confidence: lineConfidence,
        bbox: {
          x: Number(Math.max(0, Math.min(1, x0 / imageWidth)).toFixed(4)),
          y: Number(Math.max(0, Math.min(1, y0 / imageHeight)).toFixed(4)),
          width: Number(Math.max(0, Math.min(1, (x1 - x0) / imageWidth)).toFixed(4)),
          height: Number(Math.max(0, Math.min(1, (y1 - y0) / imageHeight)).toFixed(4)),
        },
      };
    })
    .filter((b) => b.text.length > 0);
}

/**
 * Checks whether two line bounding boxes represent the same horizontal row.
 * @param {{ x: number, y: number, width: number, height: number }} a
 * @param {{ x: number, y: number, width: number, height: number }} b
 */
function isSameLineBand(a, b) {
  const aTop = a.y;
  const aBot = a.y + a.height;
  const bTop = b.y;
  const bBot = b.y + b.height;
  const overlapY = Math.max(0, Math.min(aBot, bBot) - Math.max(aTop, bTop));
  const minH = Math.max(0.001, Math.min(a.height, b.height));
  if (overlapY / minH < 0.45) return false;

  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const minW = Math.max(0.001, Math.min(a.width, b.width));
  return overlapX / minW > 0.35;
}

/**
 * Checks if sorted line blocks contain suspicious vertical gaps where table rows may have been skipped.
 * @param {Array<{ bbox: { y: number, height: number } }>} blocks
 */
function hasSuspiciousVerticalGaps(blocks) {
  if (blocks.length < 4) return true;
  const sorted = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y);
  for (let i = 1; i < sorted.length; i += 1) {
    const prevBottom = sorted[i - 1].bbox.y + sorted[i - 1].bbox.height;
    const gap = sorted[i].bbox.y - prevBottom;
    if (gap > 0.035) return true;
  }
  return false;
}

/**
 * Performs OCR processing on an image buffer, extracting text, confidence, line bounding boxes, and image dimensions.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, confidence: number, blocks: Array<{ text: string, confidence?: number, bbox: { x: number, y: number, width: number, height: number } }>, width: number, height: number }>}
 */
export async function recognizeImageText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { text: '', confidence: 0, blocks: [], width: 1000, height: 1414 };
  }

  try {
    // 1. Get accurate image dimensions using createImageBitmap
    const blob = new Blob([buffer]);
    const imageBitmap = await createImageBitmap(blob);
    const imageWidth = imageBitmap.width || 1000;
    const imageHeight = imageBitmap.height || 1414;
    imageBitmap.close(); // Clean up memory

    // 2. Reuse worker and perform OCR with table-friendly PSM.SINGLE_COLUMN ('4')
    const worker = await getWorker();
    const uint8Array = new Uint8Array(buffer);
    const canSetParams = typeof worker.setParameters === 'function';

    if (canSetParams) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM?.SINGLE_COLUMN ?? '4',
        preserve_interword_spaces: '1',
      });
    }

    // @ts-ignore
    const ret = await worker.recognize(uint8Array, {}, { blocks: true });

    const rawConfidence = ret.data.confidence;
    const normalizedConfidence = typeof rawConfidence === 'number' ? rawConfidence / 100 : 0;

    let blocks = extractNormalizedLines(
      ret.data,
      imageWidth,
      imageHeight,
      normalizedConfidence
    );

    // 3. Recovery pass with PSM.SINGLE_BLOCK ('6') if dense table rows left vertical gaps
    if (canSetParams && hasSuspiciousVerticalGaps(blocks)) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM?.SINGLE_BLOCK ?? '6',
        preserve_interword_spaces: '1',
      });
      // @ts-ignore
      const fallbackRet = await worker.recognize(uint8Array, {}, { blocks: true });
      const fallbackBlocks = extractNormalizedLines(
        fallbackRet.data,
        imageWidth,
        imageHeight,
        normalizedConfidence
      );

      for (const fb of fallbackBlocks) {
        if (!blocks.some((existing) => isSameLineBand(existing.bbox, fb.bbox))) {
          blocks.push(fb);
        }
      }
      blocks.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    }

    const mergedText =
      blocks.length > 0 ? blocks.map((b) => b.text).join('\n') : ret.data.text || '';

    return {
      text: mergedText,
      confidence: normalizedConfidence,
      blocks,
      width: imageWidth,
      height: imageHeight,
    };
  } catch (error) {
    throw new Error(ERROR_CODE.OCR_FAILED);
  }
}
