// @ts-check
/**
 * PART 5. 원본을 페이지 이미지(캔버스)로 그린다. (브라우저 전용)
 *
 * - PDF 파일   → pdf.js로 각 페이지를 그린다.
 * - 사진 파일  → 사진을 그대로 캔버스에 그린다.
 * - 원본이 없을 때(샘플 데이터 등) → DocumentModel의 글자를 흰 페이지에 다시 그린다. (데모용 "가짜 페이지")
 *
 * 결과의 pointsPerPixel: 새 PDF에서 페이지 크기(포인트)를 정할 때 쓴다. (PDF 페이지 크기 = 픽셀 × pointsPerPixel)
 */

import { pdfjsLib } from './pdfjs.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */

/**
 * @typedef {Object} RenderedPage
 * @property {number} pageIndex
 * @property {HTMLCanvasElement | OffscreenCanvas} canvas
 * @property {number} pointsPerPixel
 */

/** PDF를 그릴 배율. 2배면 A4가 약 1190×1684px (화면·인쇄에 충분하고 휴대폰 메모리에 부담이 적음) */
const PDF_RENDER_SCALE = 2;
/** 사진·가짜 페이지의 해상도 가정 (150dpi) → 1px = 72/150pt */
const IMAGE_POINTS_PER_PIXEL = 72 / 150;
/** 가짜 페이지 최대 너비. 원본 픽셀 크기(예: 2480)를 그대로 쓰면 휴대폰에서 무겁다 */
const SYNTHETIC_MAX_WIDTH = 1240;

/**
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
export function createCanvas(width, height) {
  // 화면이 있는 브라우저에서는 일반 캔버스를 쓴다 (pdf.js 그리기와 가장 잘 맞음)
  if (typeof globalThis.document !== 'undefined') {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new Error('CANVAS_UNAVAILABLE');
}

/** @param {HTMLCanvasElement | OffscreenCanvas} canvas */
function context2d(canvas) {
  const ctx = /** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */ (
    canvas.getContext('2d')
  );
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  return ctx;
}

/**
 * PDF 각 페이지를 캔버스로 그린다.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<RenderedPage[]>}
 */
export async function renderPdfPages(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  /** @type {RenderedPage[]} */
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = context2d(canvas);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: /** @type {any} */ (canvas), canvasContext: /** @type {any} */ (ctx), viewport })
        .promise;
      pages.push({ pageIndex: i - 1, canvas, pointsPerPixel: 1 / PDF_RENDER_SCALE });
      page.cleanup();
    }
  } finally {
    // pdf.js 6: 문서는 loadingTask로 닫는다
    await loadingTask.destroy();
  }
  return pages;
}

/**
 * 사진 파일을 캔버스로 그린다. (사진 한 장 = 한 페이지)
 * TODO(PART 1과 협의): PART 1이 원근 보정한 이미지를 기준으로 좌표를 준다면, 보정된 이미지를 받아서 그려야 한다.
 * @param {Blob} file
 * @returns {Promise<RenderedPage[]>}
 */
export async function renderImagePage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  context2d(canvas).drawImage(bitmap, 0, 0);
  bitmap.close();
  return [{ pageIndex: 0, canvas, pointsPerPixel: IMAGE_POINTS_PER_PIXEL }];
}

/**
 * 원본 파일이 없을 때, DocumentModel의 글자를 흰 페이지에 다시 그린다. (샘플 데이터 데모용)
 * @param {DocumentModel} document
 * @returns {RenderedPage[]}
 */
export function renderSyntheticPages(document) {
  return document.pages.map((page) => {
    const ratio = Math.min(1, SYNTHETIC_MAX_WIDTH / page.width);
    const width = Math.round(page.width * ratio);
    const height = Math.round(page.height * ratio);
    const canvas = createCanvas(width, height);
    const ctx = context2d(canvas);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    for (const block of page.blocks) {
      const fontSize = Math.max(10, Math.floor(block.bbox.height * height * 0.8));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillText(block.text, block.bbox.x * width, block.bbox.y * height, block.bbox.width * width);
    }
    return { pageIndex: page.pageIndex, canvas, pointsPerPixel: IMAGE_POINTS_PER_PIXEL / ratio };
  });
}

/**
 * 캔버스를 JPEG 바이트로 바꾼다.
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {Promise<Uint8Array>}
 */
export async function canvasToJpeg(canvas) {
  /** @type {Blob | null} */
  let blob;
  if ('convertToBlob' in canvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  } else {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }
  if (!blob) throw new Error('CANVAS_EXPORT_FAILED');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 캔버스를 줄인 새 캔버스를 만든다. (화면 미리보기용. 이미 가린 캔버스를 줄이므로 원본 글자가 다시 나오지 않는다)
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @param {number} maxWidth
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
export function scaleCanvas(canvas, maxWidth) {
  if (canvas.width <= maxWidth) return canvas;
  const ratio = maxWidth / canvas.width;
  const small = createCanvas(maxWidth, Math.round(canvas.height * ratio));
  context2d(small).drawImage(/** @type {CanvasImageSource} */ (canvas), 0, 0, small.width, small.height);
  return small;
}

/**
 * 원본 종류에 맞게 페이지를 그린다.
 * @param {DocumentModel} document
 * @param {Blob | undefined} file
 * @returns {Promise<RenderedPage[]>}
 */
export async function renderPages(document, file) {
  if (file && file.size > 0) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(/** @type {File} */ (file).name ?? '');
    if (isPdf) return renderPdfPages(await file.arrayBuffer());
    return renderImagePage(file);
  }
  return renderSyntheticPages(document);
}
