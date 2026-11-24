// @ts-check
/**
 * PART 5. AI 프롬프트에 넣는 가린 글에 쪽 표시("--- page 2 ---")를 넣는다 (#276 리뷰 후속)
 *
 * 프롬프트 답변 규칙(PART 3)은 AI에게 "어느 서류 몇 쪽"인지 밝히라고 하는데,
 * 가린 글(PART 4 applyMaskingPlan의 maskedText)에는 쪽 경계가 없다.
 * PART 4 코드는 바꾸지 않고, 서류를 쪽마다 나눠 같은 함수로 다시 가린 뒤 쪽 표시를 붙인다.
 *
 * 안전: 쪽마다 가린 글을 이은 것이 이미 보내기 전 검사(validateMaskedText)를 통과한 글과
 * 한 글자라도 다르면 쪽 표시를 넣지 않은 검사한 글을 그대로 쓴다. 쪽 표시 말고는 검사한 글과 똑같은 글만 나간다.
 */

/** @param {number} pageIndex 0부터 */
export const pageMark = (pageIndex) => `--- page ${pageIndex + 1} ---`;

/**
 * @param {import('../shared/document-model.js').DocumentModel[]} documents
 * @param {Record<string, string>} checkedText  documentId → 보내기 전 검사를 통과한 가린 글
 * @param {(docs: import('../shared/document-model.js').DocumentModel[]) => Record<string, string> | null} maskDocs
 *   서류 목록을 받아 documentId → 가린 글을 돌려주는 함수 (applyMaskingPlan을 같은 계획·편집으로 부름). 실패하면 null
 * @returns {Record<string, string>} documentId → 쪽 표시를 넣은 가린 글 (키·순서는 checkedText와 같음)
 */
export function withPageMarks(documents, checkedText, maskDocs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [documentId, checked] of Object.entries(checkedText)) {
    out[documentId] = markOne(
      documents.find((d) => d.documentId === documentId),
      checked,
      maskDocs,
    );
  }
  return out;
}

/**
 * @param {import('../shared/document-model.js').DocumentModel | undefined} doc
 * @param {string} checked
 * @param {(docs: import('../shared/document-model.js').DocumentModel[]) => Record<string, string> | null} maskDocs
 */
function markOne(doc, checked, maskDocs) {
  if (!doc || !Array.isArray(doc.pages) || doc.pages.length === 0) return checked;
  /** @type {{ pageIndex: number, text: string }[]} */
  const pages = [];
  for (const page of doc.pages) {
    // 블록이 없는 쪽은 가린 글에 줄을 남기지 않으므로 표시도 하지 않는다 (이어 붙인 글이 검사한 글과 같아야 함)
    if (!page.blocks?.length) continue;
    let masked;
    try {
      masked = maskDocs([{ ...doc, pages: [page] }]);
    } catch {
      return checked;
    }
    const text = masked?.[doc.documentId];
    if (typeof text !== 'string') return checked;
    pages.push({ pageIndex: page.pageIndex, text });
  }
  if (pages.map((p) => p.text).join('\n') !== checked) return checked;
  return pages.map((p) => `${pageMark(p.pageIndex)}\n${p.text}`).join('\n');
}
