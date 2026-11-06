// @ts-check
/**
 * PART 5. 마스킹 PDF 생성
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수: exportMaskedPDF(document, plan) → Result<{ fileName: string, blob: Blob }>
 *
 * 규칙: 원본 PDF 위에 검은 상자만 덮지 않는다.
 *   1) 페이지를 이미지로 렌더링 (render-pages.js, pdf.js)
 *   2) plan.items의 bbox(0~1 정규화)를 픽셀로 바꿔 이미지에 직접 마스킹·가명 표시 (apply-redactions.js)
 *   3) 그 이미지로 새 PDF 생성 (export-pdf.js, pdf-lib)
 *   4) 메타데이터 제거 (metadata-cleaner.js)
 *   5) 다시 읽어 텍스트·메타데이터가 남지 않았는지 검증 (validate-pdf.js)
 *
 * TODO(PART 5): 위 단계를 구현한다. 그 전까지는 NOT_IMPLEMENTED를 돌려주고, 화면은 이를 "준비 중"으로 표시한다.
 */

import { fail, ok, ERROR_CODE, isValidBBox } from '../../shared/document-model.js';

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
 * 원본 문서와 마스킹 계획으로 새 PDF를 만든다.
 * @param {DocumentModel} document
 * @param {MaskingPlan} plan
 */
// eslint-disable-next-line no-unused-vars
export async function exportMaskedPDF(document, plan) {
  const coords = checkPlanCoordinates(plan);
  if (!coords.ok) return coords;
  // TODO(PART 5): 실제 PDF 생성
  return fail(ERROR_CODE.NOT_IMPLEMENTED, 'Masked PDF export is not ready yet.');
}
