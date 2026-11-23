// @ts-check
/**
 * PART 5. 따로 읽은 조각(계약서 PDF + 특약 별지 PDF·사진 등)을 한 서류로 잇는다 (#298)
 *
 * 글자 PDF와 사진을 PDF 하나로 합쳐서 읽으면 PART 1이 전체를 글자 PDF로 보고 사진 쪽을 읽지 않는다.
 * 그래서 조각마다 따로 읽고(글자 PDF는 글자로, 사진은 OCR로) 여기서 쪽을 이어 붙인다.
 * - 쪽 번호(pageIndex)는 0부터 다시 매긴다. 마스킹 PDF는 조각을 같은 순서로 합친 PDF로 그리므로 쪽이 맞는다.
 * - blockId는 "p{쪽}_b{번호}" 모양을 지키며 새 쪽 번호로 바꾼다 (서류 안에서 겹치지 않게).
 * - 좌표(bbox, spans)는 쪽마다 0~1이라 그대로 둔다.
 * - 한 조각이라도 사진·스캔(OCR)이면 서류 전체를 "그림 PDF"로 보고 "Check the text" 단계에서 확인한다.
 */

import { DOCUMENT_TYPE, SOURCE_TYPE } from '../shared/document-model.js';

/** @typedef {import('../shared/document-model.js').DocumentModel} DocumentModel */

const isOcr = (/** @type {DocumentModel} */ d) => d.sourceType === SOURCE_TYPE.IMAGE || d.sourceType === SOURCE_TYPE.IMAGE_PDF;

/**
 * @param {DocumentModel[]} parts  조각마다 읽은 결과 (순서대로)
 * @returns {DocumentModel}
 */
export function mergeDocumentModels(parts) {
  if (parts.length === 1) return parts[0];
  /** @type {DocumentModel['pages']} */
  const pages = [];
  for (const part of parts) {
    for (const page of part.pages) {
      const pageIndex = pages.length;
      pages.push({
        ...page,
        pageIndex,
        blocks: (page.blocks ?? []).map((b, i) => ({
          ...b,
          blockId: /^p\d+_/.test(b.blockId) ? b.blockId.replace(/^p\d+_/, `p${pageIndex}_`) : `p${pageIndex}_b${i}`,
        })),
      });
    }
  }
  return {
    documentId: parts[0].documentId,
    documentType: DOCUMENT_TYPE.UNKNOWN,
    sourceType: parts.some(isOcr) ? SOURCE_TYPE.IMAGE_PDF : parts[0].sourceType,
    pages,
  };
}
