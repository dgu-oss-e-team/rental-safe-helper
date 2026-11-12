// @ts-check
import { createWorker } from 'tesseract.js';
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

    // 2. Reuse worker and perform OCR with { blocks: true } option
    const worker = await getWorker();
    const uint8Array = new Uint8Array(buffer);
    // @ts-ignore
    const ret = await worker.recognize(uint8Array, {}, { blocks: true });

    const rawConfidence = ret.data.confidence;
    const normalizedConfidence = typeof rawConfidence === 'number' ? rawConfidence / 100 : 0;

    // 3. Flatten blocks -> paragraphs -> lines in Tesseract v7 structure
    /** @type {any[]} */
    const rawLines = [];
    if (ret.data.blocks && Array.isArray(ret.data.blocks)) {
      for (const block of ret.data.blocks) {
        if (block.paragraphs && Array.isArray(block.paragraphs)) {
          for (const para of block.paragraphs) {
            if (para.lines && Array.isArray(para.lines)) {
              rawLines.push(...para.lines);
            }
          }
        }
      }
    }

    const blocks = rawLines
      .map((line) => {
        const { x0, y0, x1, y1 } = line.bbox;
        const lineText = line.text ? line.text.trim() : '';
        const lineConfidence =
          typeof line.confidence === 'number'
            ? Number((line.confidence / 100).toFixed(4))
            : normalizedConfidence;

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

    return {
      text: ret.data.text || '',
      confidence: normalizedConfidence,
      blocks,
      width: imageWidth,
      height: imageHeight,
    };
  } catch (error) {
    throw new Error(ERROR_CODE.OCR_FAILED);
  }
}