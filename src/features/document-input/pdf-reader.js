// @ts-check
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure standard PDF.js worker location
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}

/**
 * Extracts raw text and page content from a PDF ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ pageCount: number, textPages: string[] }>}
 */
export async function readPdfText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { pageCount: 0, textPages: [] };
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDocument = await loadingTask.promise;
  const textPages = [];

  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((/** @type {any} */ item) => ('str' in item ? item.str : ''))
      .join(' ');
    textPages.push(pageText);
  }

  return {
    pageCount: pdfDocument.numPages,
    textPages,
  };
}