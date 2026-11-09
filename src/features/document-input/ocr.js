// @ts-check
import { createWorker } from 'tesseract.js';

/**
 * Performs OCR processing on an image buffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, confidence: number }>}
 */
export async function recognizeImageText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { text: '', confidence: 0 };
  }

  let worker = null;
  try {
    worker = await createWorker('kor+eng');
    const ret = await worker.recognize(new Uint8Array(buffer));

    const rawConfidence = ret.data.confidence;
    const normalizedConfidence = typeof rawConfidence === 'number' ? rawConfidence / 100 : 0;

    return {
      text: ret.data.text || '',
      confidence: normalizedConfidence,
    };
  } catch (error) {
    throw new Error('OCR_FAILED');
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}