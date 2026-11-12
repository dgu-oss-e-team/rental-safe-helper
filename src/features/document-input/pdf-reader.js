// @ts-check
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Creates a 2D canvas in browser or OffscreenCanvas environments.
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
function createRenderCanvas(width, height) {
  if (typeof globalThis.document !== 'undefined') {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  throw new Error('CANVAS_UNAVAILABLE');
}

/**
 * Converts a rendered canvas to a PNG ArrayBuffer.
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {Promise<ArrayBuffer>}
 */
async function canvasToPngBuffer(canvas) {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('CANVAS_TO_BLOB_FAILED'));
          return;
        }
        resolve(blob.arrayBuffer());
      }, 'image/png');
    });
  }
  throw new Error('CANVAS_UNAVAILABLE');
}

/**
 * Renders each page of a PDF buffer into PNG image buffers for OCR fallback.
 * @param {ArrayBuffer} buffer
 * @param {number} [scale=2.0]
 * @returns {Promise<Array<{ pageIndex: number, buffer: ArrayBuffer, width: number, height: number }>>}
 */
export async function renderPdfToImages(buffer, scale = 2.0) {
  if (!buffer || buffer.byteLength === 0) {
    return [];
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDocument = await loadingTask.promise;
  /** @type {Array<{ pageIndex: number, buffer: ArrayBuffer, width: number, height: number }>} */
  const renderedPages = [];

  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width) || 1000;
    const height = Math.ceil(viewport.height) || 1414;

    const canvas = createRenderCanvas(width, height);
    const ctx = /** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */ (
      canvas.getContext('2d')
    );
    if (!ctx) {
      throw new Error('CANVAS_UNAVAILABLE');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await page.render({
      canvas: /** @type {any} */ (canvas),
      canvasContext: /** @type {any} */ (ctx),
      viewport,
    }).promise;

    const pngBuffer = await canvasToPngBuffer(canvas);
    renderedPages.push({
      pageIndex: i - 1,
      buffer: pngBuffer,
      width,
      height,
    });
  }

  return renderedPages;
}

/**
 * Extracts text, dynamic page dimensions, and normalized grouped line bounding boxes from a PDF buffer.
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
      
      /** @type {Array<{ text: string, x: number, y: number, w: number, h: number }>} */
      const rawItems = [];

      for (const item of textContent.items) {
        if ('str' in item && item.str.trim().length > 0) {
          // Use pdfjsLib.Util.transform to apply viewport rotation & transform matrix
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const itemWidth = item.width || 0;
          const itemHeight = item.height || Math.abs(tx[3]) || 12;

          // tx[4] is X, tx[5] is Y (viewport top-left origin)
          const x = tx[4];
          const y = tx[5] - itemHeight;

          rawItems.push({
            text: item.str,
            x,
            y,
            w: itemWidth,
            h: itemHeight,
          });
        }
      }

      // Group text items on the same horizontal Y line (~4px threshold)
      const Y_THRESHOLD = 4.0;
      /** @type {Array<Array<{ text: string, x: number, y: number, w: number, h: number }>>} */
      const lineGroups = [];

      // Sort top-to-bottom, left-to-right
      rawItems.sort((a, b) => (Math.abs(a.y - b.y) <= Y_THRESHOLD ? a.x - b.x : a.y - b.y));

      for (const item of rawItems) {
        const matchingGroup = lineGroups.find((group) =>
          group.some((gItem) => Math.abs(gItem.y - item.y) <= Y_THRESHOLD)
        );

        if (matchingGroup) {
          matchingGroup.push(item);
        } else {
          lineGroups.push([item]);
        }
      }

      let pageText = '';
      /** @type {Array<{ blockId: string, text: string, bbox: { x: number, y: number, width: number, height: number }, confidence: null }>} */
      const blocks = [];

      lineGroups.forEach((group, groupIdx) => {
        // Sort items left-to-right within the line
        group.sort((a, b) => a.x - b.x);

        // Gap-aware join: insert space only when horizontal gap exceeds 20% of text height
        const joinedText = group
          .reduce((acc, item, i) => {
            if (i === 0) return item.text;
            const prev = group[i - 1];
            const gap = item.x - (prev.x + prev.w);
            return acc + (gap > Math.min(prev.h, item.h) * 0.2 ? ' ' : '') + item.text;
          }, '')
          .replace(/\s+/g, ' ')
          .trim();

        pageText += joinedText + '\n';

        // Bounding box union [minX, minY, maxX, maxY]
        const minX = Math.min(...group.map((g) => g.x));
        const minY = Math.min(...group.map((g) => g.y));
        const maxX = Math.max(...group.map((g) => g.x + g.w));
        const maxY = Math.max(...group.map((g) => g.y + g.h));

        const normX = Math.max(0, Math.min(1, minX / pageWidth));
        const normY = Math.max(0, Math.min(1, minY / pageHeight));
        const normW = Math.max(0, Math.min(1, (maxX - minX) / pageWidth));
        const normH = Math.max(0, Math.min(1, (maxY - minY) / pageHeight));

        blocks.push({
          blockId: `p${i - 1}_b${groupIdx}`,
          text: joinedText,
          bbox: {
            x: Number(normX.toFixed(4)),
            y: Number(normY.toFixed(4)),
            width: Number(normW.toFixed(4)),
            height: Number(normH.toFixed(4)),
          },
          confidence: null,
        });
      });

      textPages.push(pageText.trim());
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
