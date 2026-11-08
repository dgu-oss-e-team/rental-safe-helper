// @ts-check
import { createWorker } from 'tesseract.js';

/**
 * Performs OCR processing on an image buffer or file.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
export async function recognizeImageText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return '';
  }

  console.log('Processing image buffer for OCR, size:', buffer.byteLength);

  const worker = await createWorker('kor+eng');
  const ret = await worker.recognize(new Uint8Array(buffer));
  await worker.terminate();

  return ret.data.text || '';
}