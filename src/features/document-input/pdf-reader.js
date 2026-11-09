// @ts-check
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Extracts raw text and page content from a PDF ArrayBuffer.
 * TODO(PART 1): Full block extraction for PART 2 integration
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ pageCount: number, textPages: string[] }>}
 */
export async function readPdfText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { pageCount: 0, textPages: [] };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdfDocument = await loadingTask.promise;
    const textPages = [];

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();

      let pageText = '';
      for (const item of textContent.items) {
        if ('str' in item) {
          pageText += item.str;
          if (/** @type {any} */ (item).hasEOL) {
            pageText += '\n';
          }
        }
      }
      textPages.push(pageText);
    }

    return {
      pageCount: pdfDocument.numPages,
      textPages,
    };
  } catch (error) {
    throw new Error('PDF_READ_FAILED');
  }
}