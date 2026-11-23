// @ts-check
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * Builds pdf.js getDocument options with locally bundled CMap, standard font, Wasm, and ICC URLs.
 * @param {ArrayBuffer} buffer
 */
export function buildPdfDocumentParams(buffer) {
  const proc = /** @type {{ cwd?: () => string } | undefined} */ (/** @type {any} */ (globalThis).process);
  if (typeof window === 'undefined' && proc && typeof proc.cwd === 'function') {
    const cwd = proc.cwd().replace(/\\/g, '/');
    return {
      data: new Uint8Array(buffer),
      cMapUrl: `${cwd}/node_modules/pdfjs-dist/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${cwd}/node_modules/pdfjs-dist/standard_fonts/`,
      wasmUrl: `${cwd}/node_modules/pdfjs-dist/wasm/`,
      iccUrl: `${cwd}/node_modules/pdfjs-dist/iccs/`,
    };
  }
  const metaEnv = /** @type {{ env?: { BASE_URL?: string } }} */ (import.meta).env;
  const baseUrl = metaEnv?.BASE_URL || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return {
    data: new Uint8Array(buffer),
    cMapUrl: `${normalizedBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${normalizedBase}standard_fonts/`,
    wasmUrl: `${normalizedBase}wasm/`,
    iccUrl: `${normalizedBase}iccs/`,
  };
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

  const loadingTask = pdfjsLib.getDocument(buildPdfDocumentParams(buffer));
  try {
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
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Normalizes a raw item bounding box into 0-1 coordinates clamped within the parent block bbox.
 * @param {{ x: number, y: number, w: number, h: number }} item
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {{ x: number, y: number, width: number, height: number }} blockBbox
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function buildClampedSpanBbox(item, pageWidth, pageHeight, blockBbox) {
  const blockRight = Number((blockBbox.x + blockBbox.width).toFixed(4));
  const blockBottom = Number((blockBbox.y + blockBbox.height).toFixed(4));

  const rawNormX = Math.max(0, Math.min(1, item.x / pageWidth));
  const rawNormY = Math.max(0, Math.min(1, item.y / pageHeight));
  const rawNormW = Math.max(0, Math.min(1, item.w / pageWidth));
  const rawNormH = Math.max(0, Math.min(1, item.h / pageHeight));

  let x = Math.max(blockBbox.x, Math.min(blockRight, Number(rawNormX.toFixed(4))));
  let y = Math.max(blockBbox.y, Math.min(blockBottom, Number(rawNormY.toFixed(4))));

  const maxW = Math.max(0, Number((blockRight - x).toFixed(4)));
  const maxH = Math.max(0, Number((blockBottom - y).toFixed(4)));

  let width = Math.max(0, Math.min(maxW, Number(rawNormW.toFixed(4))));
  let height = Math.max(0, Math.min(maxH, Number(rawNormH.toFixed(4))));

  if (width === 0 && blockBbox.width > 0) {
    if (maxW > 0) {
      width = Math.min(0.0001, maxW);
    } else {
      x = Math.max(blockBbox.x, Number((blockRight - 0.0001).toFixed(4)));
      width = Number((blockRight - x).toFixed(4));
    }
  }

  if (height === 0 && blockBbox.height > 0) {
    if (maxH > 0) {
      height = Math.min(0.0001, maxH);
    } else {
      y = Math.max(blockBbox.y, Number((blockBottom - 0.0001).toFixed(4)));
      height = Number((blockBottom - y).toFixed(4));
    }
  }

  return { x, y, width, height };
}

/**
 * Extracts text, dynamic page dimensions, and normalized grouped line bounding boxes (with item spans) from a PDF buffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ pageCount: number, textPages: string[], pages: Array<{ pageIndex: number, width: number, height: number, blocks: Array<{ blockId: string, text: string, bbox: { x: number, y: number, width: number, height: number }, confidence: null, spans: Array<{ start: number, end: number, bbox: { x: number, y: number, width: number, height: number } }> }> }> }>}
 */
export async function readPdfText(buffer) {
  if (!buffer || buffer.byteLength === 0) {
    return { pageCount: 0, textPages: [], pages: [] };
  }

  const loadingTask = pdfjsLib.getDocument(buildPdfDocumentParams(buffer));
  try {
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
        if ('str' in item) {
          const sanitizedStr = item.str.replace(/[\u0000-\u001f]/g, ' ');
          if (sanitizedStr.trim().length > 0) {
            // Use pdfjsLib.Util.transform to apply viewport rotation & transform matrix
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const itemWidth = item.width || 0;
            const itemHeight = item.height || Math.abs(tx[3]) || 12;

            // tx[4] is X, tx[5] is Y (viewport top-left origin)
            const x = tx[4];
            const y = tx[5] - itemHeight;

            rawItems.push({
              text: sanitizedStr,
              x,
              y,
              w: itemWidth,
              h: itemHeight,
            });
          }
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
      /** @type {Array<{ blockId: string, text: string, bbox: { x: number, y: number, width: number, height: number }, confidence: null, spans: Array<{ start: number, end: number, bbox: { x: number, y: number, width: number, height: number } }> }>} */
      const blocks = [];

      lineGroups.forEach((group, groupIdx) => {
        // Sort items left-to-right within the line
        group.sort((a, b) => a.x - b.x);

        // Bounding box union [minX, minY, maxX, maxY]
        const minX = Math.min(...group.map((g) => g.x));
        const minY = Math.min(...group.map((g) => g.y));
        const maxX = Math.max(...group.map((g) => g.x + g.w));
        const maxY = Math.max(...group.map((g) => g.y + g.h));

        const normX = Math.max(0, Math.min(1, minX / pageWidth));
        const normY = Math.max(0, Math.min(1, minY / pageHeight));
        const normW = Math.max(0, Math.min(1, (maxX - minX) / pageWidth));
        const normH = Math.max(0, Math.min(1, (maxY - minY) / pageHeight));

        const blockBbox = {
          x: Number(normX.toFixed(4)),
          y: Number(normY.toFixed(4)),
          width: Number(normW.toFixed(4)),
          height: Number(normH.toFixed(4)),
        };

        // Gap- and overlap-aware join with exact character span tracking:
        // - Insert space when horizontal gap exceeds 20% of text height
        // - Also insert space when items overlap or abut (gap <= 0) as separate fields,
        //   while preserving minor glyph kerning between single characters
        // - Inserted spaces and collapsed/trimmed whitespace belong to no span
        let joinedText = '';
        /** @type {Array<{ start: number, end: number, bbox: { x: number, y: number, width: number, height: number } }>} */
        const spans = [];

        /** @type {{ text: string, x: number, y: number, w: number, h: number, normText: string } | null} */
        let prevEmitted = null;

        group.forEach((item) => {
          const normalizedItemText = item.text.replace(/\s+/g, ' ').trim();
          if (normalizedItemText.length === 0) return;

          if (prevEmitted) {
            const minH = Math.min(prevEmitted.h, item.h);
            const gap = item.x - (prevEmitted.x + prevEmitted.w);
            const isSingleGlyphPair =
              prevEmitted.normText.length === 1 && normalizedItemText.length === 1;
            const isHalfWidthGlyphPair =
              /^[0-9A-Za-z-]$/.test(prevEmitted.normText) && /^[0-9A-Za-z-]$/.test(normalizedItemText);

            // Skip synthetic fake-bold overstrike of the exact same single glyph at nearly identical X
            if (
              isSingleGlyphPair &&
              prevEmitted.normText === normalizedItemText &&
              Math.abs(item.x - prevEmitted.x) <= Math.max(1.5, minH * 0.15)
            ) {
              return;
            }

            const isSeparateOverlappingField = isSingleGlyphPair
              ? item.x <= prevEmitted.x
              : item.x <= prevEmitted.x ||
                (prevEmitted.w > 0 && item.x <= prevEmitted.x + prevEmitted.w * 0.5) ||
                gap <= -minH * 0.25;

            const gapThreshold = isHalfWidthGlyphPair ? minH * 0.35 : minH * 0.2;
            const needsSpace =
              gap > gapThreshold ||
              isSeparateOverlappingField ||
              /\s$/.test(prevEmitted.text) ||
              /^\s/.test(item.text);

            if (needsSpace) {
              joinedText += ' ';
            }
          }

          const start = joinedText.length;
          joinedText += normalizedItemText;
          const end = joinedText.length;

          spans.push({
            start,
            end,
            bbox: buildClampedSpanBbox(item, pageWidth, pageHeight, blockBbox),
          });
          prevEmitted = { ...item, normText: normalizedItemText };
        });

        pageText += joinedText + '\n';

        blocks.push({
          blockId: `p${i - 1}_b${groupIdx}`,
          text: joinedText,
          bbox: blockBbox,
          confidence: null,
          spans,
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
  } finally {
    await loadingTask.destroy();
  }
}