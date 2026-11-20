// @ts-check
/**
 * PART 5. 서류 종류 → 화면·프롬프트에 쓰는 이름
 *
 * 화면(②·④·⑤)과 AI 프롬프트가 같은 이름을 쓰도록 한곳에 둔다.
 * (이 파일은 UI를 불러오지 않아서 pipeline.js에서도 가볍게 쓸 수 있다)
 */

import { DOCUMENT_TYPE } from '../shared/document-model.js';

export const DOCUMENT_TEXT = {
  [DOCUMENT_TYPE.REGISTRY]: 'Property register (등기부등본)',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease contract (임대차계약서)',
  [DOCUMENT_TYPE.UNKNOWN]: 'Unknown document',
};

/**
 * AI 프롬프트의 "### 제목"에 쓸 서류 이름. (#240)
 * 마스킹 결과(maskedText)의 키는 documentId("doc-1795…")라서 그대로 쓰면 AI가 어느 서류인지 알 수 없다.
 * - 등기부·계약서: DOCUMENT_TEXT 이름
 * - 종류를 모르는 서류: "Document N" (N은 올린 순서, 1부터)
 * - 같은 이름이 또 나오면 뒤에 " 2", " 3"을 붙여 겹치지 않게 한다
 * @param {{ documentId: string, documentType?: string }[]} documents
 * @returns {Map<string, string>} documentId → 이름
 */
export function promptDocumentTitles(documents) {
  /** @type {Map<string, string>} */
  const titles = new Map();
  /** @type {Map<string, number>} */
  const used = new Map();
  documents.forEach((doc, index) => {
    const known = doc.documentType !== DOCUMENT_TYPE.UNKNOWN && DOCUMENT_TEXT[doc.documentType ?? ''];
    const base = known || `Document ${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    titles.set(doc.documentId, count === 1 ? base : `${base} ${count}`);
  });
  return titles;
}

/**
 * maskedText의 키(documentId)를 프롬프트용 서류 이름으로 바꾼 새 객체 (순서는 그대로)
 * 원래 maskedText(④ 화면·PDF·검사에 쓰는 것)는 바꾸지 않는다.
 * @param {Record<string, string>} maskedText  documentId → 마스킹된 글
 * @param {{ documentId: string, documentType?: string }[]} documents
 * @returns {Record<string, string>}
 */
export function titledMaskedText(maskedText, documents) {
  const titles = promptDocumentTitles(documents);
  /** @type {Record<string, string>} */
  const out = {};
  let extra = documents.length;
  for (const [documentId, text] of Object.entries(maskedText)) {
    // documents에 없는 서류는 생기지 않지만, 생겨도 내부 ID 대신 번호를 쓴다
    let title = titles.get(documentId);
    if (!title) {
      extra += 1;
      title = `Document ${extra}`;
    }
    out[title] = text;
  }
  return out;
}
