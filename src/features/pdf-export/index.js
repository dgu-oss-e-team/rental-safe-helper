// @ts-check
/**
 * PART 5. 마스킹 PDF 생성
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수: exportMaskedPDF(document, plan, { file }) → Result<{ fileName: string, blob: Blob, pageCount: number }>
 *   - file: 사용자가 올린 원본 파일. 없거나 빈 파일이면(샘플 데이터) 문서 글자로 "가짜 페이지"를 그려 데모한다.
 * 공개 함수: previewMaskedPages(document, plan, { file }) → Result<{ pages: { pageIndex, blob, width, height }[] }>
 *   - ④ 확인 화면용 미리보기. PDF와 똑같이 그린 페이지를 줄인 JPEG 이미지. (PART 5 화면에서만 씀)
 *
 * 규칙: 원본 PDF 위에 검은 상자만 덮지 않는다.
 *   1) 페이지를 이미지로 렌더링 (render-pages.js, pdf.js)
 *   2) plan.items의 bbox(0~1 정규화)를 픽셀로 바꿔 이미지에 직접 마스킹·가명 표시 (apply-redactions.js)
 *   3) 그 이미지로 새 PDF 생성 (export-pdf.js, pdf-lib)
 *   4) 메타데이터 제거 (metadata-cleaner.js)
 *   5) 다시 읽어 텍스트·메타데이터가 남지 않았는지 검증 (validate-pdf.js)
 *
 * 안전장치: 글자를 읽지 못한 페이지(스캔 PDF 등)가 있으면 PDF를 만들지 않는다.
 *   그 페이지는 개인정보를 찾지 못해 아무것도 가려지지 않은 채 나갈 수 있기 때문이다.
 */

import { fail, ok, ERROR_CODE, isValidBBox } from '../../shared/document-model.js';
import { planRedactions, drawRedactions } from './apply-redactions.js';

// pdf.js·pdf-lib는 크기가 커서(약 1MB) 첫 화면에서 불러오지 않고, PDF를 만들 때만 불러온다.
// (중간발표 피드백: 휴대폰에서 무겁지 않게)
const loadPdfTools = () =>
  Promise.all([import('./render-pages.js'), import('./export-pdf.js'), import('./validate-pdf.js')]);

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */

/**
 * 마스킹 계획의 좌표가 규칙에 맞는지 먼저 확인한다. (PDF 생성 전 단계에서 사용)
 * @param {MaskingPlan} plan
 */
export function checkPlanCoordinates(plan) {
  const bad = plan.items.filter((item) => !isValidBBox(item.bbox));
  if (bad.length > 0) {
    return fail(ERROR_CODE.COORDINATE_INVALID, `${bad.length} masking area(s) have invalid coordinates.`);
  }
  return ok({ count: plan.items.length });
}

/**
 * 글자를 읽은 페이지 번호 목록. 글자가 하나도 없는 페이지는 빠진다.
 * @param {DocumentModel} document
 * @returns {Set<number>}
 */
export function pagesWithText(document) {
  const result = new Set();
  for (const page of document?.pages ?? []) {
    if (page.blocks?.some((b) => typeof b.text === 'string' && b.text.trim() !== '')) {
      result.add(page.pageIndex);
    }
  }
  return result;
}

/**
 * 다운로드 파일 이름. 원본 파일 이름에는 개인정보가 있을 수 있어 쓰지 않는다.
 * @param {DocumentModel} document
 */
function maskedFileName(document) {
  const kind = { REGISTRY: 'registry', LEASE_CONTRACT: 'lease-contract' }[document.documentType] ?? 'document';
  return `masked-${kind}.pdf`;
}

/**
 * 1)~2) 단계: 페이지를 그리고 마스킹까지 그린 캔버스를 돌려준다. (PDF 만들기와 화면 미리보기가 함께 쓴다)
 * 안전장치(좌표 검사, 못 읽은 페이지 거부)도 여기서 한 번에 한다.
 * @param {DocumentModel} document
 * @param {MaskingPlan} plan
 * @param {Blob | undefined} file
 * @returns {Promise<import('../../shared/document-model.js').Result<import('./render-pages.js').RenderedPage[]>>}
 */
async function renderMaskedPages(document, plan, file) {
  if (!document?.pages || !plan?.items) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Document or masking plan is missing.');
  }
  const coords = checkPlanCoordinates(plan);
  if (!coords.ok) return coords;

  const readable = pagesWithText(document);
  if (readable.size === 0) {
    return fail(ERROR_CODE.LOW_CONFIDENCE, 'No text was read from this document, so it cannot be masked safely.');
  }

  const { renderPages } = await import('./render-pages.js');
  const rendered = await renderPages(document, file);

  // 원본에는 있는데 글자를 읽지 못한 페이지가 있으면 만들지 않는다 (가려지지 않은 채 나갈 수 있음)
  const unreadable = rendered.filter((p) => !readable.has(p.pageIndex));
  if (unreadable.length > 0) {
    return fail(
      ERROR_CODE.LOW_CONFIDENCE,
      `${unreadable.length} page(s) could not be read, so the masked PDF was not created.`,
    );
  }

  for (const page of rendered) {
    const ctx = /** @type {CanvasRenderingContext2D} */ (page.canvas.getContext('2d'));
    const drawItems = planRedactions(plan, {
      documentId: document.documentId,
      pageIndex: page.pageIndex,
      width: page.canvas.width,
      height: page.canvas.height,
    });
    drawRedactions(ctx, drawItems);
  }
  return ok(rendered);
}

/** 미리보기 이미지 최대 너비(px). 휴대폰 화면에 충분하고 메모리를 적게 쓴다 */
const PREVIEW_MAX_WIDTH = 900;

/**
 * ④ 보내기 전 확인 화면용: 마스킹된 페이지를 이미지로 미리 만든다. (PDF와 같은 방법으로 그림)
 * 결과 이미지는 이미 가린 페이지를 줄인 것이라 원본 글자가 남지 않는다.
 * @param {DocumentModel} document
 * @param {MaskingPlan} plan
 * @param {{ file?: Blob }} [options]
 * @returns {Promise<import('../../shared/document-model.js').Result<{ pages: { pageIndex: number, blob: Blob, width: number, height: number }[] }>>}
 */
export async function previewMaskedPages(document, plan, options = {}) {
  try {
    const rendered = await renderMaskedPages(document, plan, options.file);
    if (!rendered.ok) return rendered;

    const { scaleCanvas, canvasToJpeg } = await import('./render-pages.js');
    const pages = [];
    for (const page of rendered.data) {
      const small = scaleCanvas(page.canvas, PREVIEW_MAX_WIDTH);
      pages.push({
        pageIndex: page.pageIndex,
        blob: new Blob([await canvasToJpeg(small)], { type: 'image/jpeg' }),
        width: small.width,
        height: small.height,
      });
    }
    return ok({ pages });
  } catch {
    // 오류 내용에 서류 정보가 섞일 수 있어 그대로 내보내지 않는다
    return fail(ERROR_CODE.PDF_EXPORT_FAILED, 'Could not create the preview.');
  }
}

/**
 * 원본 문서와 마스킹 계획으로 새 PDF를 만든다.
 * @param {DocumentModel} document
 * @param {MaskingPlan} plan
 * @param {{ file?: Blob }} [options]
 * @returns {Promise<import('../../shared/document-model.js').Result<{ fileName: string, blob: Blob, pageCount: number }>>}
 */
export async function exportMaskedPDF(document, plan, options = {}) {
  try {
    const rendered = await renderMaskedPages(document, plan, options.file);
    if (!rendered.ok) return rendered;

    const [{ canvasToJpeg }, { buildImageOnlyPdf }, { validateMaskedPdf }] = await loadPdfTools();
    const images = [];
    for (const page of rendered.data) {
      images.push({
        bytes: await canvasToJpeg(page.canvas),
        format: /** @type {const} */ ('jpeg'),
        widthPt: page.canvas.width * page.pointsPerPixel,
        heightPt: page.canvas.height * page.pointsPerPixel,
      });
    }

    const pdfBytes = await buildImageOnlyPdf(images);
    const check = await validateMaskedPdf(pdfBytes);
    if (!check.ok) return check;

    return ok({
      fileName: maskedFileName(document),
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
      pageCount: check.data.pageCount,
    });
  } catch {
    // 오류 내용에 서류 정보가 섞일 수 있어 그대로 내보내지 않는다
    return fail(ERROR_CODE.PDF_EXPORT_FAILED, 'Could not create the masked PDF.');
  }
}
