// @ts-check
import { createWorker } from 'tesseract.js';
import { ERROR_CODE } from '../../shared/document-model.js';

/**
 * Performs OCR processing on an image buffer, extracting text, confidence, line bounding boxes, and image dimensions.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, confidence: number, blocks: Array<{ text: string, bbox: { x: number, y: number, width: number, height: number } }>, width: number, height: number }>}
 */
export async function recognizeImageText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { text: '', confidence: 0, blocks: [], width: 1000, height: 1414 };
  }

  let worker = null;
  try {
    // Initialize Tesseract worker with local asset paths (no external CDN)
    worker = await createWorker('kor+eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
      langPath: '/tesseract/lang-data',
    });

    const uint8Array = new Uint8Array(buffer);
    const ret = await worker.recognize(uint8Array);
    
    const rawConfidence = ret.data.confidence;
    const normalizedConfidence = typeof rawConfidence === 'number' ? rawConfidence / 100 : 0;

    // Determine image dimensions from Tesseract metadata or fallbacks
    // @ts-ignore
    const imageWidth = ret.data.imageColor?.width || ret.data.imageBinary?.width || 1000;
    // @ts-ignore
    const imageHeight = ret.data.imageColor?.height || ret.data.imageBinary?.height || 1414;

    // Extract line-level bounding boxes normalized to 0.0 – 1.0 range
    // @ts-ignore
    const lines = ret.data.lines || [];

    const blocks = lines
      .map((/** @type {any} */ line) => {
        const { x0, y0, x1, y1 } = line.bbox;
        return {
          text: line.text ? line.text.trim() : '',
          bbox: {
            x: Math.max(0, Math.min(1, x0 / imageWidth)),
            y: Math.max(0, Math.min(1, y0 / imageHeight)),
            width: Math.max(0, Math.min(1, (x1 - x0) / imageWidth)),
            height: Math.max(0, Math.min(1, (y1 - y0) / imageHeight)),
          }
        };
      })
      .filter((/** @type {any} */ b) => b.text.length > 0);

    return {
      text: ret.data.text || '',
      confidence: normalizedConfidence,
      blocks,
      width: imageWidth,
      height: imageHeight,
    };
  } catch (error) {
    // Standardize error to ERROR_CODE.OCR_FAILED
    throw new Error(ERROR_CODE.OCR_FAILED);
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}