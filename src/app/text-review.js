// @ts-check
/**
 * PART 5. 분석이 끝난 뒤 "Check the text" 단계로 다시 돌아가기 (#286)
 *
 * 사진·스캔(OCR) 서류에서 글자가 잘못 읽히면(예: "서울" → "서물") 개인정보 탐지가 놓치고,
 * 보내기 전 검사(#282)가 멈춘다. 이때 사용자가 할 수 있는 일은 잘못 읽힌 글자를 고치는 것이다.
 * 분석 결과에 들어 있는 서류(이미 확인·수정한 글자)로 글자 확인 단계를 다시 연다. 고친 내용은 그대로 남는다.
 */

import { SOURCE_TYPE } from '../shared/document-model.js';

/**
 * 글자 확인이 필요한 서류(사진·스캔)인지 (pipeline.js needsTextReview와 같은 기준)
 * @param {{ sourceType?: string }} doc
 */
export const isPhotoDocument = (doc) => doc.sourceType === SOURCE_TYPE.IMAGE || doc.sourceType === SOURCE_TYPE.IMAGE_PDF;

/**
 * 분석 결과에 사진·스캔 서류가 있는지
 * @param {{ documents?: { sourceType?: string }[] } | null | undefined} analysis
 */
export function hasPhotoDocuments(analysis) {
  return Boolean(analysis?.documents?.some(isPhotoDocument));
}

/**
 * 분석 결과로 "Check the text" 단계 상태를 다시 만든다. 사진·스캔 서류가 없으면 null.
 * @param {{ files: File[], documents: any[] }} analysis
 * @param {import('./upload-check.js').UploadSlot[] | null} slots  파일마다 올린 칸 (#186)
 * @returns {{ ocrReview: { read: { files: File[], documents: any[] }, files: File[], slots: import('./upload-check.js').UploadSlot[] | null }, draft: any[] } | null}
 */
export function textReviewFromAnalysis(analysis, slots) {
  const indexes = analysis.documents.map((d, i) => (isPhotoDocument(d) ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) return null;
  return {
    ocrReview: {
      read: { files: analysis.files, documents: analysis.documents },
      files: indexes.map((i) => analysis.files[i]),
      slots,
    },
    // 고치는 동안 분석 결과가 바뀌지 않게 복사본을 고친다 (main.js ocrDraft)
    draft: structuredClone(indexes.map((i) => analysis.documents[i])),
  };
}
