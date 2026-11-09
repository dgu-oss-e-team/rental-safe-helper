// @ts-check
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Extracts text, dynamic page dimensions, and normalized bounding boxes from a PDF buffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ pageCount: number, textPages: string[], pages: Array<{ pageIndex: number, width: number, height: number, blocks: Array<{ blockId: string, text: string, bbox: { x: number, y: number, width: number, height: number }, confidence: null }> }> }>}
 */
export async function readPdfText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { pageCount: 0, textPages: [], pages: [] };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdfDocument = await loadingTask.promise;
    const textPages = [];
    const pages = [];

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const pageWidth = viewport.width || 1000;
      const pageHeight = viewport.height || 1414;

      const textContent = await page.getTextContent();
      let pageText = '';
      /** @type {Array<{ blockId: string, text: string, bbox: { x: number, y: number, width: number, height: number }, confidence: null }>} */
      const blocks = [];

      let blockIdx = 0;
      for (const item of textContent.items) {
        if ('str' in item && item.str.trim().length > 0) {
          const str = item.str;
          pageText += str;
          if (/** @type {any} */ (item).hasEOL) {
            pageText += '\n';
          }

          // Compute position from transform matrix [scaleX, skewY, skewX, scaleY, translateX, translateY]
          const transform = /** @type {any} */ (item).transform || [1, 0, 0, 1, 0, 0];
          const rawX = transform[4];
          const rawY = transform[5];
          const itemWidth = /** @type {any} */ (item).width || 0;
          const itemHeight = /** @type {any} */ (item).height || Math.abs(transform[3]) || 12;

          // PDF Y-axis originates from bottom-left; convert to top-left origin normalized coordinates (0.0 to 1.0)
          const normX = Math.max(0, Math.min(1, rawX / pageWidth));
          const normY = Math.max(0, Math.min(1, (pageHeight - rawY - itemHeight) / pageHeight));
          const normW = Math.max(0, Math.min(1, itemWidth / pageWidth));
          const normH = Math.max(0, Math.min(1, itemHeight / pageHeight));

          blocks.push({
            blockId: `p${i - 1}_b${blockIdx++}`,
            text: str.trim(),
            bbox: {
              x: Number(normX.toFixed(4)),
              y: Number(normY.toFixed(4)),
              width: Number(normW.toFixed(4)),
              height: Number(normH.toFixed(4)),
            },
            confidence: null, // PDF text extraction has no OCR confidence
          });
        }
      }

      textPages.push(pageText);
      pages.push({
        pageIndex: i - 1,
        width: pageWidth,
        height: pageHeight,
        blocks,
      });
    }

    return {
      pageCount: pdfDocument.numPages,
      textPages,
      pages,
    };
  } catch (error) {
    throw new Error('PDF_READ_FAILED');
  }
}